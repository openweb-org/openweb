import type { Page, Response as PwResponse } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

/**
 * Bilibili L3 runner — page-based API access with Wbi signing.
 *
 * Bilibili uses Wbi signing on most API endpoints: an MD5-based hash of sorted
 * query params + mixing key derived from /x/web-interface/nav. The browser's own
 * JS handles this automatically, so we intercept API responses from page navigation.
 *
 * For search, we navigate to search.bilibili.com which calls the search API internally.
 * For other endpoints, we navigate to the relevant page and intercept the API calls.
 */

type Errors = AdapterHelpers['errors']

/** Check if a Bilibili API response indicates success (code === 0). */
function isApiOk(resp: unknown): boolean {
  return resp != null && typeof resp === 'object' && (resp as Record<string, unknown>).code === 0
}

/* ---------- helpers ---------- */

async function getCSRFToken(page: Page, errors: Errors): Promise<string> {
  const cookies = await page.context().cookies('https://www.bilibili.com')
  const biliJct = cookies.find((c) => c.name === 'bili_jct')
  if (!biliJct?.value) throw errors.needsLogin()
  return biliJct.value
}

async function postApiViaPage(
  page: Page,
  apiPath: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return page.evaluate(
    async ({ path, data }) => {
      const form = new URLSearchParams()
      for (const [k, v] of Object.entries(data)) {
        if (v !== undefined && v !== null) form.set(k, String(v))
      }
      const resp = await fetch(new URL(path, 'https://api.bilibili.com').toString(), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      })
      return resp.json()
    },
    { path: apiPath, data: body },
  )
}

async function interceptApiResponse(
  page: Page,
  urlPattern: string,
  navigateUrl: string,
  timeout = 15000,
  /** Use exact path match instead of includes (avoids /view matching /view/conclusion/judge) */
  exactPath = false,
): Promise<unknown> {
  const responsePromise = page.waitForResponse(
    (resp: PwResponse) => {
      if (resp.status() !== 200) return false
      const url = resp.url()
      if (exactPath) {
        try {
          const parsed = new URL(url)
          return parsed.pathname === urlPattern
        } catch { return false } // intentional: malformed URL in network intercept
      }
      return url.includes(urlPattern)
    },
    { timeout },
  )
  await page.goto(navigateUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  const resp = await responsePromise
  return resp.json()
}

async function fetchApiViaPage(
  page: Page,
  apiPath: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  // Use page.evaluate to call fetch from the page context — inherits cookies + Wbi signing
  return page.evaluate(
    async ({ path, qs }) => {
      const url = new URL(path, 'https://api.bilibili.com')
      for (const [k, v] of Object.entries(qs)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
      }
      const resp = await fetch(url.toString(), { credentials: 'include' })
      return resp.json()
    },
    { path: apiPath, qs: params },
  )
}

/* ---------- operation handlers ---------- */

function stripEmTags(obj: unknown): unknown {
  if (typeof obj === 'string') return obj.replace(/<\/?em[^>]*>/g, '')
  if (Array.isArray(obj)) return obj.map(stripEmTags)
  if (obj !== null && typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out[k] = stripEmTags(v)
    return out
  }
  return obj
}

function trimSearchResponse(resp: unknown): unknown {
  if (!isApiOk(resp)) return resp
  const r = resp as Record<string, unknown>
  const data = r.data as Record<string, unknown> | undefined
  if (!data) return resp
  const results = data.result as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(results)) return resp
  const videoResults = results.find((r) => r.result_type === 'video')
  const videos = videoResults?.data as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(videos)) return { ...r, data: { ...data, result: [] } }
  const trimmedVideos = videos.map((v) => ({
    type: v.type, bvid: v.bvid, aid: v.aid, mid: v.mid,
    author: v.author, title: v.title, description: v.description,
    pic: v.pic, play: v.play, danmaku: v.danmaku, like: v.like,
    favorites: v.favorites, review: v.review, duration: v.duration,
    pubdate: v.pubdate, tag: v.tag, typename: v.typename,
  }))
  return {
    ...r,
    data: {
      page: data.page, pagesize: data.pagesize, numResults: data.numResults, numPages: data.numPages,
      result: stripEmTags(trimmedVideos),
    },
  }
}

async function searchVideos(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const keyword = String(params.keyword ?? '')
  if (!keyword) throw errors.missingParam('keyword')
  const pg = Number(params.page ?? 1)

  const searchUrl = `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}&page=${pg}`
  const resp = await interceptApiResponse(
    page,
    '/x/web-interface/wbi/search/all/v2',
    searchUrl,
  ).catch(() => null)

  if (isApiOk(resp)) return trimSearchResponse(resp)

  const fallback = await fetchApiViaPage(page, '/x/web-interface/wbi/search/all/v2', {
    keyword,
    page: pg,
    page_size: params.page_size ?? 42,
    search_type: 'video',
  })
  return trimSearchResponse(fallback)
}

function trimVideoDetail(resp: unknown): unknown {
  if (!isApiOk(resp)) return resp
  const r = resp as Record<string, unknown>
  const data = r.data as Record<string, unknown> | undefined
  if (!data?.View) return resp
  const view = data.View as Record<string, unknown>
  const stat = view.stat as Record<string, unknown> | undefined
  const owner = view.owner as Record<string, unknown> | undefined
  const pages = view.pages as Array<Record<string, unknown>> | undefined
  return {
    code: r.code, message: r.message, ttl: r.ttl,
    data: {
      View: {
        bvid: view.bvid, aid: view.aid, cid: view.cid, title: view.title,
        desc: view.desc, pic: view.pic, pubdate: view.pubdate, duration: view.duration,
        videos: view.videos, tname: view.tname, copyright: view.copyright,
        owner: owner ? { mid: owner.mid, name: owner.name, face: owner.face } : undefined,
        stat: stat ? { view: stat.view, danmaku: stat.danmaku, reply: stat.reply, favorite: stat.favorite, coin: stat.coin, like: stat.like, share: stat.share } : undefined,
        pages: pages?.map((p) => ({ cid: p.cid, page: p.page, part: p.part, duration: p.duration })),
      },
      Tags: data.Tags,
      Card: data.Card ? { card: (data.Card as Record<string, unknown>).card } : undefined,
    },
  }
}

async function getVideoDetail(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const bvid = String(params.bvid ?? '')
  const aid = params.aid != null ? Number(params.aid) : undefined
  if (!bvid && !aid) throw errors.missingParam('bvid')

  const videoUrl = bvid
    ? `https://www.bilibili.com/video/${bvid}`
    : `https://www.bilibili.com/video/av${aid}`

  const resp = await interceptApiResponse(
    page,
    '/x/web-interface/wbi/view/detail',
    videoUrl,
    15000,
    true,
  ).catch(() => null)
  if (isApiOk(resp)) return trimVideoDetail(resp)

  const fallback = await fetchApiViaPage(page, '/x/web-interface/wbi/view/detail', {
    ...(bvid ? { bvid } : {}),
    ...(aid ? { aid } : {}),
    need_view: 1,
  })
  return trimVideoDetail(fallback)
}

async function getPopularVideos(page: Page, params: Readonly<Record<string, unknown>>, _helpers: AdapterHelpers): Promise<unknown> {
  const pn = Number(params.pn ?? 1)
  const ps = Number(params.ps ?? 20)

  return interceptApiResponse(
    page,
    '/x/web-interface/popular',
    'https://www.bilibili.com/v/popular/all',
  ).catch(async () => {
    return fetchApiViaPage(page, '/x/web-interface/popular', { pn, ps })
  })
}

async function getVideoComments(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const oid = Number(params.oid)
  if (!oid) throw errors.missingParam('oid')
  const bvid = String(params.bvid ?? '')
  if (!bvid) throw errors.missingParam('bvid')

  const responsePromise = page.waitForResponse(
    (resp: PwResponse) => resp.status() === 200 && resp.url().includes('/x/v2/reply/wbi/main'),
    { timeout: 20000 },
  )
  await page.goto(`https://www.bilibili.com/video/${bvid}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const resp = await responsePromise
  return resp.json()
}

async function getUserInfo(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const mid = Number(params.mid)
  if (!mid) throw errors.missingParam('mid')

  const resp = await interceptApiResponse(
    page,
    '/x/space/wbi/acc/info',
    `https://space.bilibili.com/${mid}`,
    20000,
  )
  return trimUserProfile(resp)
}

function trimUserProfile(resp: unknown): unknown {
  if (!isApiOk(resp)) return resp
  const r = resp as Record<string, unknown>
  const d = r.data as Record<string, unknown> | undefined
  if (!d) return resp
  const official = d.official as Record<string, unknown> | undefined
  const vip = d.vip as Record<string, unknown> | undefined
  const liveRoom = d.live_room as Record<string, unknown> | undefined
  return {
    code: r.code, message: r.message, ttl: r.ttl,
    data: {
      mid: d.mid, name: d.name, sex: d.sex, face: d.face, sign: d.sign,
      rank: d.rank, level: d.level, birthday: d.birthday,
      official: official ? { role: official.role, title: official.title, type: official.type } : undefined,
      vip: vip ? { type: vip.type, status: vip.status } : undefined,
      is_followed: d.is_followed,
      tags: d.tags,
      school: d.school,
      live_room: liveRoom ? { status: liveRoom.status, url: liveRoom.url, title: liveRoom.title } : undefined,
    },
  }
}

async function getUserVideos(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const mid = Number(params.mid)
  if (!mid) throw errors.missingParam('mid')

  return interceptApiResponse(
    page,
    '/x/space/wbi/arc/search',
    `https://space.bilibili.com/${mid}/video`,
    20000,
  )
}

async function getRecommendedFeed(page: Page, params: Readonly<Record<string, unknown>>, _helpers: AdapterHelpers): Promise<unknown> {
  const ps = Number(params.ps ?? 12)

  return interceptApiResponse(
    page,
    '/x/web-interface/wbi/index/top/feed/rcmd',
    'https://www.bilibili.com',
  ).catch(async () => {
    return fetchApiViaPage(page, '/x/web-interface/wbi/index/top/feed/rcmd', {
      ps,
      fresh_type: params.fresh_type ?? 4,
    })
  })
}

/* ---------- danmaku (protobuf decode in browser) ---------- */

/**
 * Fetch a protobuf endpoint in browser context and decode danmaku elems.
 * Bilibili's /x/v2/dm/wbi/web/seg.so returns DmSegMobileReply protobuf:
 *   message DmSegMobileReply { repeated DanmakuElem elems = 1; }
 *   message DanmakuElem {
 *     int64 id=1; int32 progress=2; int32 mode=3; int32 fontsize=4;
 *     uint32 color=5; string midHash=6; string content=7; int64 ctime=8;
 *   }
 * We decode just the fields agents care about: content, progress, mode, color.
 */
async function fetchProtobufDanmaku(
  page: Page,
  apiPath: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  // All inner functions use arrow syntax to avoid tsup __name decorators in browser context
  return page.evaluate(
    async ({ path, qs }) => {
      const url = new URL(path, 'https://api.bilibili.com')
      for (const [k, v] of Object.entries(qs)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
      }
      const resp = await fetch(url.toString(), { credentials: 'include' })
      const buf = await resp.arrayBuffer()
      const bytes = new Uint8Array(buf)

      let pos = 0
      const readVarint = (): number => {
        let result = 0
        let shift = 0
        while (pos < bytes.length) {
          const b = bytes[pos++]
          result |= (b & 0x7f) << shift
          if ((b & 0x80) === 0) return result
          shift += 7
        }
        return result
      }
      const readBytes = (): Uint8Array => {
        const len = readVarint()
        const data = bytes.slice(pos, pos + len)
        pos += len
        return data
      }
      const skipField = (wireType: number) => {
        if (wireType === 0) readVarint()
        else if (wireType === 1) pos += 8
        else if (wireType === 2) { const len = readVarint(); pos += len }
        else if (wireType === 5) pos += 4
      }
      const decodeElem = (data: Uint8Array) => {
        const elem: Record<string, unknown> = {}
        let p = 0
        const d = data
        const rv = (): number => {
          let r = 0
          let s = 0
          while (p < d.length) {
            const b = d[p++]
            r |= (b & 0x7f) << s
            if ((b & 0x80) === 0) return r
            s += 7
          }
          return r
        }
        const rb = (): Uint8Array => {
          const len = rv()
          const out = d.slice(p, p + len)
          p += len
          return out
        }
        const sf = (wt: number) => {
          if (wt === 0) rv()
          else if (wt === 1) p += 8
          else if (wt === 2) { const len = rv(); p += len }
          else if (wt === 5) p += 4
        }
        while (p < d.length) {
          const tag = rv()
          const fieldNum = tag >>> 3
          const wireType = tag & 0x7
          if (fieldNum === 2 && wireType === 0) elem.progress_ms = rv()
          else if (fieldNum === 3 && wireType === 0) elem.mode = rv()
          else if (fieldNum === 5 && wireType === 0) elem.color = rv()
          else if (fieldNum === 7 && wireType === 2) elem.content = new TextDecoder().decode(rb())
          else if (fieldNum === 8 && wireType === 0) elem.ctime = rv()
          else sf(wireType)
        }
        return elem
      }

      const elems: Record<string, unknown>[] = []
      while (pos < bytes.length) {
        const tag = readVarint()
        const fieldNum = tag >>> 3
        const wireType = tag & 0x7
        if ((fieldNum === 1 || fieldNum === 2) && wireType === 2) {
          const decoded = decodeElem(readBytes())
          if (decoded.content) elems.push(decoded)
        } else {
          skipField(wireType)
        }
      }
      return { code: 0, data: { elems } }
    },
    { path: apiPath, qs: params },
  )
}

async function getDanmaku(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const oid = Number(params.oid)
  if (!oid) throw errors.missingParam('oid')
  const segmentIndex = Number(params.segment_index ?? 1)
  const type = Number(params.type ?? 1)

  return fetchProtobufDanmaku(page, '/x/v2/dm/wbi/web/seg.so', {
    oid,
    segment_index: segmentIndex,
    type,
  })
}

/* ---------- nav / relation / online ---------- */

async function getNavInfo(page: Page, _params: Readonly<Record<string, unknown>>, _helpers: AdapterHelpers): Promise<unknown> {
  return fetchApiViaPage(page, '/x/web-interface/nav', {})
}

async function getVideoOnlineCount(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const bvid = String(params.bvid ?? '')
  const aid = params.aid != null ? Number(params.aid) : undefined
  if (!bvid && !aid) throw errors.missingParam('bvid')
  const qs: Record<string, unknown> = {}
  if (bvid) qs.bvid = bvid
  if (aid) qs.aid = aid
  const cid = params.cid != null ? Number(params.cid) : undefined
  if (cid) qs.cid = cid
  return fetchApiViaPage(page, '/x/player/online/total', qs)
}

async function getVideoUserRelation(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const bvid = String(params.bvid ?? '')
  const aid = params.aid != null ? Number(params.aid) : undefined
  if (!bvid && !aid) throw errors.missingParam('bvid')
  const qs: Record<string, unknown> = {}
  if (bvid) qs.bvid = bvid
  if (aid) qs.aid = aid
  return fetchApiViaPage(page, '/x/web-interface/archive/relation', qs)
}

/* ---------- write operations ---------- */

async function listFavoriteFolders(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const cookies = await page.context().cookies('https://www.bilibili.com')
  const mid = cookies.find((c) => c.name === 'DedeUserID')?.value
  if (!mid) throw errors.needsLogin()
  const ps = Number(params.ps ?? 20)
  const pn = Number(params.pn ?? 1)
  return fetchApiViaPage(page, '/x/v3/fav/folder/created/list', { up_mid: mid, ps, pn })
}

async function likeVideo(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const aid = Number(params.aid)
  if (!aid) throw errors.missingParam('aid')
  const like = Number(params.like ?? 1)
  const csrf = await getCSRFToken(page, errors)
  return postApiViaPage(page, '/x/web-interface/archive/like', { aid, like, csrf })
}

async function addToFavorites(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const rid = Number(params.rid)
  if (!rid) throw errors.missingParam('rid')
  const addMediaIds = String(params.add_media_ids ?? '')
  if (!addMediaIds) throw errors.missingParam('add_media_ids')
  const csrf = await getCSRFToken(page, errors)
  return postApiViaPage(page, '/x/v3/fav/resource/deal', {
    rid,
    type: 2,
    add_media_ids: addMediaIds,
    del_media_ids: params.del_media_ids ?? '',
    csrf,
  })
}

async function followUploader(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const fid = Number(params.fid)
  if (!fid) throw errors.missingParam('fid')
  const act = Number(params.act ?? 1)
  const csrf = await getCSRFToken(page, errors)
  return postApiViaPage(page, '/x/relation/modify', { fid, act, re_src: 11, csrf })
}

/* ---------- reverse write operations ---------- */

async function unlikeVideo(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  return likeVideo(page, { ...params, like: 2 }, helpers)
}

async function removeFromFavorites(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const rid = Number(params.rid)
  if (!rid) throw errors.missingParam('rid')
  const delMediaIds = String(params.del_media_ids ?? '')
  if (!delMediaIds) throw errors.missingParam('del_media_ids')
  const csrf = await getCSRFToken(page, errors)
  return postApiViaPage(page, '/x/v3/fav/resource/deal', {
    rid,
    type: 2,
    add_media_ids: '',
    del_media_ids: delMediaIds,
    csrf,
  })
}

async function unfollowUploader(page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown> {
  return followUploader(page, { ...params, act: 2 }, helpers)
}

/* ---------- runner export ---------- */

type Handler = (page: Page, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers) => Promise<unknown>

const OPERATIONS: Record<string, Handler> = {
  searchVideos,
  getVideoDetail,
  getPopularVideos,
  getVideoComments,
  getDanmaku,
  getRecommendedFeed,
  getNavInfo,
  getVideoOnlineCount,
  getVideoUserRelation,
  likeVideo,
  addToFavorites,
  followUploader,
  unlikeVideo,
  removeFromFavorites,
  unfollowUploader,
  getUserProfile: getUserInfo,
  searchUserVideos: getUserVideos,
  listFavoriteFolders,
}

const runner: CustomRunner = {
  name: 'bilibili-web',
  description: 'Bilibili (哔哩哔哩) — video search, detail, trending, comments, user profiles via page API interception',

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('bilibili-web requires a page (transport: page)')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params, helpers)
  },
}

export default runner
