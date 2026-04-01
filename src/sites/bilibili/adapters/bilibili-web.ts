import type { Page, Response as PwResponse } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
/**
 * Bilibili L3 adapter — page-based API access with Wbi signing.
 *
 * Bilibili uses Wbi signing on most API endpoints: an MD5-based hash of sorted
 * query params + mixing key derived from /x/web-interface/nav. The browser's own
 * JS handles this automatically, so we intercept API responses from page navigation.
 *
 * For search, we navigate to search.bilibili.com which calls the search API internally.
 * For other endpoints, we navigate to the relevant page and intercept the API calls.
 */
import type { CodeAdapter } from '../../../types/adapter.js'

const API_BASE = 'https://api.bilibili.com'

/* ---------- helpers ---------- */

async function getCSRFToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies('https://www.bilibili.com')
  const biliJct = cookies.find((c) => c.name === 'bili_jct')
  if (!biliJct?.value) throw OpenWebError.needsLogin()
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

async function searchVideos(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const keyword = String(params.keyword ?? '')
  if (!keyword) throw OpenWebError.missingParam('keyword')
  const pg = Number(params.page ?? 1)

  // Navigate to search page — triggers the search API internally
  const searchUrl = `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}&page=${pg}`
  const resp = await interceptApiResponse(
    page,
    '/x/web-interface/wbi/search/all/v2',
    searchUrl,
  ).catch(() => null)

  if (resp && typeof resp === 'object' && (resp as any).code === 0) return resp

  // Fallback: use in-page fetch (browser handles Wbi signing)
  return fetchApiViaPage(page, '/x/web-interface/wbi/search/all/v2', {
    keyword,
    page: pg,
    page_size: params.page_size ?? 42,
    search_type: 'video',
  })
}

async function getVideoDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const bvid = String(params.bvid ?? '')
  if (!bvid) throw OpenWebError.missingParam('bvid')

  // Use direct page.evaluate fetch — more reliable than intercepting
  return fetchApiViaPage(page, '/x/web-interface/view', { bvid })
}

async function getPopularVideos(page: Page, params: Record<string, unknown>): Promise<unknown> {
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

async function getVideoComments(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const oid = Number(params.oid)
  if (!oid) throw OpenWebError.missingParam('oid')
  const type = Number(params.type ?? 1)
  const mode = Number(params.mode ?? 3)

  // Try non-wbi reply endpoint first (doesn't require signing)
  const result = await fetchApiViaPage(page, '/x/v2/reply/main', {
    oid,
    type,
    mode,
    pagination_str: JSON.stringify({ offset: '' }),
  })
  if (result && typeof result === 'object' && (result as any).code === 0) return result

  // Fallback: navigate to video page and intercept the wbi comment API
  const bvid = String(params.bvid ?? '')
  if (bvid) {
    return interceptApiResponse(
      page,
      '/x/v2/reply/wbi/main',
      `https://www.bilibili.com/video/${bvid}`,
    ).catch(() => result)
  }
  return result
}

async function getUserInfo(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const mid = Number(params.mid)
  if (!mid) throw OpenWebError.missingParam('mid')

  // Try non-wbi endpoint first
  const result = await fetchApiViaPage(page, '/x/space/acc/info', { mid })
  if (result && typeof result === 'object' && (result as any).code === 0) return result

  // Fallback: navigate to user space page and intercept the wbi endpoint
  return interceptApiResponse(
    page,
    '/x/space/wbi/acc/info',
    `https://space.bilibili.com/${mid}`,
  ).catch(() => result)
}

async function getUserVideos(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const mid = Number(params.mid)
  if (!mid) throw OpenWebError.missingParam('mid')
  const pn = Number(params.pn ?? 1)
  const ps = Number(params.ps ?? 30)
  const order = String(params.order ?? 'pubdate')

  // Try non-wbi endpoint first
  const result = await fetchApiViaPage(page, '/x/space/arc/search', { mid, pn, ps, order })
  if (result && typeof result === 'object' && (result as any).code === 0) return result

  // Fallback: navigate to user space and intercept the wbi endpoint
  return interceptApiResponse(
    page,
    '/x/space/wbi/arc/search',
    `https://space.bilibili.com/${mid}/video`,
  ).catch(() => result)
}

async function getRecommendedFeed(page: Page, params: Record<string, unknown>): Promise<unknown> {
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

async function getDanmaku(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const oid = Number(params.oid)
  if (!oid) throw OpenWebError.missingParam('oid')
  const segmentIndex = Number(params.segment_index ?? 1)
  const type = Number(params.type ?? 1)

  return fetchProtobufDanmaku(page, '/x/v2/dm/wbi/web/seg.so', {
    oid,
    segment_index: segmentIndex,
    type,
  })
}

/* ---------- nav / relation / online ---------- */

async function getNavInfo(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return fetchApiViaPage(page, '/x/web-interface/nav', {})
}

async function getVideoOnlineCount(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const bvid = String(params.bvid ?? '')
  const aid = params.aid != null ? Number(params.aid) : undefined
  if (!bvid && !aid) throw OpenWebError.missingParam('bvid')
  const qs: Record<string, unknown> = {}
  if (bvid) qs.bvid = bvid
  if (aid) qs.aid = aid
  const cid = params.cid != null ? Number(params.cid) : undefined
  if (cid) qs.cid = cid
  return fetchApiViaPage(page, '/x/player/online/total', qs)
}

async function getVideoUserRelation(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const bvid = String(params.bvid ?? '')
  const aid = params.aid != null ? Number(params.aid) : undefined
  if (!bvid && !aid) throw OpenWebError.missingParam('bvid')
  const qs: Record<string, unknown> = {}
  if (bvid) qs.bvid = bvid
  if (aid) qs.aid = aid
  return fetchApiViaPage(page, '/x/web-interface/archive/relation', qs)
}

/* ---------- write operations ---------- */

async function likeVideo(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const aid = Number(params.aid)
  if (!aid) throw OpenWebError.missingParam('aid')
  const like = Number(params.like ?? 1)
  const csrf = await getCSRFToken(page)
  return postApiViaPage(page, '/x/web-interface/archive/like', { aid, like, csrf })
}

async function addToFavorites(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const rid = Number(params.rid)
  if (!rid) throw OpenWebError.missingParam('rid')
  const addMediaIds = String(params.add_media_ids ?? '')
  if (!addMediaIds) throw OpenWebError.missingParam('add_media_ids')
  const csrf = await getCSRFToken(page)
  return postApiViaPage(page, '/x/v3/fav/resource/deal', {
    rid,
    type: 2,
    add_media_ids: addMediaIds,
    del_media_ids: params.del_media_ids ?? '',
    csrf,
  })
}

async function followUploader(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const fid = Number(params.fid)
  if (!fid) throw OpenWebError.missingParam('fid')
  const act = Number(params.act ?? 1)
  const csrf = await getCSRFToken(page)
  return postApiViaPage(page, '/x/relation/modify', { fid, act, re_src: 11, csrf })
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
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
  getUserProfile: getUserInfo,
  searchUserVideos: getUserVideos,
}

const adapter: CodeAdapter = {
  name: 'bilibili-web',
  description: 'Bilibili (哔哩哔哩) — video search, detail, trending, comments, user profiles via page API interception',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('bilibili.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://www.bilibili.com')
    return cookies.some((c) => c.name === 'SESSDATA')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw OpenWebError.unknownOp(operation)
      return handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
