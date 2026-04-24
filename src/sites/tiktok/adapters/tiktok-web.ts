import type { Page, Response as PwResponse } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

type Errors = AdapterHelpers['errors']

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BASE = 'https://www.tiktok.com'

/* ── shared: intercept helper ────────────────────────────────── */

/**
 * Navigate to a URL and intercept the first API response matching a URL pattern.
 * Returns the parsed JSON body, or null if no matching response within the deadline.
 */
async function interceptApi(
  page: Page,
  navigateUrl: string,
  urlPatterns: string[],
  opts?: { scroll?: boolean; scrollSteps?: number; deadline?: number },
): Promise<Record<string, unknown> | null> {
  let captured: unknown = null
  const handler = async (resp: PwResponse) => {
    if (captured) return
    const rUrl = resp.url()
    if (urlPatterns.some((p) => rUrl.includes(p))) {
      try { captured = await resp.json() } catch { /* ignore */ }
    }
  }

  page.on('response', handler)
  try {
    await page.goto(navigateUrl, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
    await wait(3000)

    if (opts?.scroll) {
      for (let i = 0; i < (opts.scrollSteps ?? 1); i++) {
        if (captured) break
        await page.evaluate(() => window.scrollBy(0, 600)).catch(() => {})
        await wait(1500)
      }
    }

    const deadline = Date.now() + (opts?.deadline ?? 15_000)
    while (!captured && Date.now() < deadline) {
      await wait(500)
    }
  } finally {
    page.off('response', handler)
  }

  return captured as Record<string, unknown> | null
}

/* ── shared: normalizers ─────────────────────────────────────── */

function normalizeVideoItem(item: Record<string, unknown>): Record<string, unknown> {
  const video = (item.video || {}) as Record<string, unknown>
  const author = (item.author || {}) as Record<string, unknown>
  const music = (item.music || {}) as Record<string, unknown>
  const stats = (item.stats || {}) as Record<string, unknown>
  const challenges = (item.challenges || []) as Array<Record<string, unknown>>

  return {
    id: item.id || '',
    description: item.desc || '',
    createTime: item.createTime ? Number(item.createTime) || null : null,
    video: {
      id: video.id || '',
      height: video.height || 0,
      width: video.width || 0,
      duration: video.duration || 0,
      cover: video.cover || video.originCover || '',
      playAddr: video.playAddr || '',
      downloadAddr: video.downloadAddr || '',
    },
    author: {
      id: author.id || '',
      uniqueId: author.uniqueId || '',
      nickname: author.nickname || '',
      avatarThumb: author.avatarThumb || '',
      signature: author.signature || '',
      verified: author.verified || false,
    },
    music: {
      id: music.id || '',
      title: music.title || '',
      authorName: music.authorName || '',
      playUrl: music.playUrl || '',
      duration: music.duration || 0,
      original: music.original || false,
      album: music.album || '',
    },
    stats: {
      diggCount: Number(stats.diggCount ?? stats.likeCount) || 0,
      shareCount: Number(stats.shareCount) || 0,
      commentCount: Number(stats.commentCount) || 0,
      playCount: Number(stats.playCount) || 0,
      collectCount: Number(stats.collectCount) || 0,
    },
    challenges: challenges.map((c) => ({
      id: c.id || '',
      title: c.title || '',
      desc: c.desc || '',
    })),
  }
}

function normalizeComment(c: Record<string, unknown>): Record<string, unknown> {
  const user = (c.user || {}) as Record<string, unknown>
  const rawTime = c.create_time ?? c.createTime
  return {
    id: c.cid || c.id || '',
    text: c.text || '',
    createTime: rawTime ? Number(rawTime) || null : null,
    diggCount: Number(c.digg_count ?? c.diggCount) || 0,
    replyCount: Number(c.reply_comment_total ?? c.replyCount) || 0,
    author: {
      id: user.uid || user.id || '',
      uniqueId: user.unique_id || user.uniqueId || '',
      nickname: user.nickname || '',
      avatarThumb: user.avatar_thumb?.url_list?.[0] || user.avatarThumb || '',
    },
  }
}

function normalizeUserDetail(data: Record<string, unknown>): Record<string, unknown> {
  const userInfo = (data.userInfo || data) as Record<string, unknown>
  const user = (userInfo.user || {}) as Record<string, unknown>
  const stats = (userInfo.stats || {}) as Record<string, unknown>

  return {
    id: user.id || '',
    uniqueId: user.uniqueId || '',
    nickname: user.nickname || '',
    avatarThumb: user.avatarThumb || '',
    avatarMedium: user.avatarMedium || '',
    signature: user.signature || '',
    verified: user.verified || false,
    privateAccount: user.privateAccount || false,
    region: user.region || '',
    stats: {
      followerCount: Number(stats.followerCount) || 0,
      followingCount: Number(stats.followingCount) || 0,
      heartCount: Number(stats.heartCount ?? stats.heart) || 0,
      videoCount: Number(stats.videoCount) || 0,
      diggCount: Number(stats.diggCount) || 0,
    },
  }
}

/* ── read ops ────────────────────────────────────────────────── */

async function searchVideos(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const keyword = String(params.keyword || '')
  if (!keyword) throw errors.missingParam('keyword')
  const count = Number(params.count) || 12

  const url = `${BASE}/search?q=${encodeURIComponent(keyword)}`
  const data = await interceptApi(page, url, ['/api/search/general/full/'])
  if (!data) return { status_code: 0, data: [], cursor: 0, has_more: 0 }

  const items = (data.data || []) as Array<Record<string, unknown>>
  return {
    status_code: 0,
    data: items.slice(0, count).map((d) => ({
      type: d.type,
      item: normalizeVideoItem((d.item || d) as Record<string, unknown>),
    })),
    cursor: data.cursor || 0,
    has_more: data.has_more || 0,
  }
}

async function searchUsers(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const keyword = String(params.keyword || '')
  if (!keyword) throw errors.missingParam('keyword')

  const url = `${BASE}/search/user?q=${encodeURIComponent(keyword)}`
  const data = await interceptApi(page, url, ['/api/search/user/full/'])
  if (!data) return { user_list: [], has_more: 0 }

  const list = (data.user_list || []) as Array<Record<string, unknown>>
  return {
    user_list: list.map((u) => {
      const info = (u.user_info || {}) as Record<string, unknown>
      return {
        user_info: {
          uid: info.uid || '',
          unique_id: info.unique_id || '',
          nickname: info.nickname || '',
          follower_count: Number(info.follower_count) || 0,
          signature: info.signature || '',
        },
      }
    }),
    cursor: data.cursor || '0',
    has_more: data.has_more || 0,
  }
}

async function getHashtagDetail(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const name = String(params.challengeName || params.hashtag || '')
  if (!name) throw errors.missingParam('challengeName')

  const data = await interceptApi(page, `${BASE}/tag/${encodeURIComponent(name)}`, ['/api/challenge/detail/'])
  if (!data) {
    const ssrResult = await page.evaluate(() => {
      const root = (window as Record<string, unknown>).__$UNIVERSAL_DATA$__ as Record<string, unknown> | undefined
      const scope = (root?.__DEFAULT_SCOPE__ as Record<string, unknown>)?.[
        'webapp.challenge-detail'
      ] as Record<string, unknown> | undefined
      return scope ?? null
    })
    if (!ssrResult) throw errors.retriable(`Hashtag "${name}" not found`)
    return trimHashtagDetail(ssrResult)
  }
  return trimHashtagDetail(data)
}

function trimHashtagDetail(data: Record<string, unknown>): Record<string, unknown> {
  const info = (data.challengeInfo || {}) as Record<string, unknown>
  const challenge = (info.challenge || {}) as Record<string, unknown>
  const stats = (info.stats || challenge.stats || {}) as Record<string, unknown>
  return {
    challengeInfo: {
      challenge: {
        id: challenge.id || '',
        title: challenge.title || '',
        desc: challenge.desc || '',
        isCommerce: challenge.isCommerce || false,
      },
      stats: {
        videoCount: Number(stats.videoCount) || 0,
        viewCount: Number(stats.viewCount) || 0,
      },
    },
    status_code: data.status_code ?? data.statusCode ?? 0,
  }
}

async function getVideoDetail(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  const username = String(params.username || '')
  if (!username) throw errors.missingParam('username')

  const handle = username.startsWith('@') ? username : `@${username}`
  const url = `${BASE}/${handle}/video/${videoId}`

  // Intercept /api/item/detail/ response triggered by page navigation
  const data = await interceptApi(page, url, ['/api/item/detail/', '/api/related/item_list'])
  if (data) {
    // /api/item/detail/ wraps the item in itemInfo.itemStruct
    const itemInfo = data.itemInfo as Record<string, unknown> | undefined
    const item = (itemInfo?.itemStruct ?? data.itemStruct ?? data) as Record<string, unknown>
    if (item.id || item.desc) return normalizeVideoItem(item)
  }

  // SSR fallback: TikTok pre-renders video data into __$UNIVERSAL_DATA$__
  const ssrResult = await page.evaluate((vid: string) => {
    const root = (window as Record<string, unknown>).__$UNIVERSAL_DATA$__ as Record<string, unknown> | undefined
    const scope = (root?.__DEFAULT_SCOPE__ as Record<string, unknown>)?.[
      'webapp.video-detail'
    ] as Record<string, unknown> | undefined
    if (!scope) return null
    const info = scope.itemInfo as Record<string, unknown> | undefined
    return (info?.itemStruct ?? scope.itemStruct ?? null) as Record<string, unknown> | null
  }, videoId)

  if (ssrResult) return normalizeVideoItem(ssrResult)

  throw errors.retriable(`Video ${videoId} not found — no API response or SSR data`)
}

async function getUserProfile(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const username = String(params.username || '')
  if (!username) throw errors.missingParam('username')

  const handle = username.startsWith('@') ? username : `@${username}`
  const url = `${BASE}/${handle}`

  // Intercept /api/user/detail/ response triggered by profile page load
  const data = await interceptApi(page, url, ['/api/user/detail/'])
  if (data) {
    if (data.userInfo || data.user) return normalizeUserDetail(data)
  }

  // SSR fallback: profile data embedded in page hydration
  const ssrResult = await page.evaluate(() => {
    const root = (window as Record<string, unknown>).__$UNIVERSAL_DATA$__ as Record<string, unknown> | undefined
    const scope = (root?.__DEFAULT_SCOPE__ as Record<string, unknown>)?.[
      'webapp.user-detail'
    ] as Record<string, unknown> | undefined
    return scope ?? null
  })

  if (ssrResult) return normalizeUserDetail(ssrResult)

  throw errors.retriable(`User @${username} not found — no API response or SSR data`)
}

async function getVideoComments(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  const username = String(params.username || '')
  if (!username) throw errors.missingParam('username')

  const handle = username.startsWith('@') ? username : `@${username}`
  const url = `${BASE}/${handle}/video/${videoId}`

  let captured: unknown = null
  const handler = async (resp: PwResponse) => {
    if (captured) return
    const rUrl = resp.url()
    if (rUrl.includes('/api/comment/list/') || rUrl.includes('/comment/list')) {
      try { captured = await resp.json() } catch { /* ignore */ }
    }
  }

  page.on('response', handler)
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
    await wait(3000)

    // Click the comment icon to trigger comment loading
    if (!captured) {
      const clicked = await page.evaluate(() => {
        const btn = document.querySelector('[data-e2e="comment-icon"]') as HTMLElement | null
        if (btn) { btn.click(); return true }
        const spans = Array.from(document.querySelectorAll('span[data-e2e="comment-count"]'))
        if (spans[0]) { (spans[0] as HTMLElement).click(); return true }
        return false
      }).catch(() => false)
      if (clicked) await wait(3000)
    }

    // Scroll to trigger lazy loading if click didn't work
    for (let i = 0; i < 4 && !captured; i++) {
      await page.evaluate(() => window.scrollBy(0, 600)).catch(() => {})
      await wait(1500)
    }

    const deadline = Date.now() + 10_000
    while (!captured && Date.now() < deadline) {
      await wait(500)
    }
  } finally {
    page.off('response', handler)
  }

  if (!captured) return { comments: [], total: 0, hasMore: false }

  const data = captured as Record<string, unknown>
  const commentsList = (data.comments || []) as Array<Record<string, unknown>>
  return {
    comments: commentsList.map(normalizeComment),
    total: data.total || commentsList.length,
    cursor: data.cursor || 0,
    hasMore: data.has_more === 1 || data.has_more === true,
  }
}

async function getHomeFeed(page: Page, _params: Record<string, unknown>, _errors: Errors): Promise<unknown> {
  const data = await interceptApi(page, `${BASE}/foryou`, ['/api/recommend/item_list/', '/api/post/item_list/'])
  if (!data) return { items: [], hasMore: false }

  const items = (data.itemList || data.items || []) as Array<Record<string, unknown>>
  return {
    items: items.map(normalizeVideoItem),
    hasMore: data.hasMore === true || data.has_more === 1,
  }
}

async function getExplore(page: Page, _params: Record<string, unknown>, _errors: Errors): Promise<unknown> {
  const data = await interceptApi(page, `${BASE}/explore`, ['/api/explore/item_list/', '/api/recommend/item_list/'])
  if (!data) return { items: [], hasMore: false }

  const items = (data.itemList || data.items || []) as Array<Record<string, unknown>>
  return {
    items: items.map(normalizeVideoItem),
    hasMore: data.hasMore === true || data.has_more === 1,
  }
}

async function getUserVideos(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const username = String(params.username || '')
  if (!username) throw errors.missingParam('username')
  const count = Number(params.count) || 30

  const handle = username.startsWith('@') ? username : `@${username}`
  const navUrl = `${BASE}/${handle}`

  // Force a fresh navigation even if already on the same profile page
  // (SPA won't re-fetch /api/post/item_list/ for same-URL navigation)
  const current = page.url()
  if (current.includes(handle)) {
    await page.goto('about:blank').catch(() => {})
    await wait(500)
  }

  const data = await interceptApi(page, navUrl, ['/api/post/item_list/', '/api/creator/item_list/'])
  if (!data) return { items: [], hasMore: false }

  const items = (data.itemList || data.items || []) as Array<Record<string, unknown>>
  return {
    items: items.slice(0, count).map(normalizeVideoItem),
    hasMore: data.hasMore === true || data.has_more === 1,
    cursor: data.cursor || '',
  }
}

async function getHashtagVideos(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const hashtag = String(params.hashtag || '')
  if (!hashtag) throw errors.missingParam('hashtag')

  const tagUrl = `${BASE}/tag/${encodeURIComponent(hashtag)}`
  const data = await interceptApi(page, tagUrl, ['/api/challenge/item_list/', '/api/search/item/'], { scroll: true, scrollSteps: 3 })

  if (data) {
    const items = (data.itemList || data.items || []) as Array<Record<string, unknown>>
    return {
      items: items.map(normalizeVideoItem),
      hasMore: data.hasMore === true || data.has_more === 1,
      cursor: data.cursor || '',
    }
  }

  const ssrResult = await page.evaluate(() => {
    const root = (window as Record<string, unknown>).__$UNIVERSAL_DATA$__ as Record<string, unknown> | undefined
    const scope = (root?.__DEFAULT_SCOPE__ as Record<string, unknown>)?.[
      'webapp.challenge-detail'
    ] as Record<string, unknown> | undefined
    return scope ?? null
  })

  if (ssrResult) {
    const itemList = (ssrResult as Record<string, unknown>).itemList as Array<Record<string, unknown>> | undefined
    if (Array.isArray(itemList) && itemList.length > 0) {
      return {
        items: itemList.map(normalizeVideoItem),
        hasMore: false,
        cursor: '',
      }
    }
  }

  return { items: [], hasMore: false }
}

async function getRelatedVideos(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  const username = String(params.username || '')
  if (!username) throw errors.missingParam('username')

  const handle = username.startsWith('@') ? username : `@${username}`
  const data = await interceptApi(
    page,
    `${BASE}/${handle}/video/${videoId}`,
    ['/api/related/item_list/'],
    { scroll: true },
  )
  if (!data) return { items: [] }

  const items = (data.itemList || data.items || []) as Array<Record<string, unknown>>
  return { items: items.map(normalizeVideoItem) }
}

/* ── write helpers ───────────────────────────────────────────── */

/**
 * Extract CSRF token from TikTok's HTTP client via webpack module walk.
 * The HTTP client module contains `csrfToken`, `runFetch`, `fetchData` in source.
 * Falls back to empty string if not found (write ops may still work without it).
 */
async function getCsrfToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    try {
      const chunks = (window as Record<string, unknown>).__LOADABLE_LOADED_CHUNKS__ as unknown[]
      if (!chunks) return ''
      let req: ((id: string) => Record<string, unknown>) | null = null
      ;(chunks as unknown[]).push([[Symbol()], {}, (r: unknown) => { req = r as (id: string) => Record<string, unknown> }])
      if (!req) return ''
      const moduleMap = (req as unknown as Record<string, unknown>).m as Record<string, unknown>
      if (!moduleMap) return ''
      for (const id of Object.keys(moduleMap)) {
        const src = (moduleMap[id] as () => void).toString()
        if (src.includes('csrfToken') && src.includes('runFetch') && src.includes('fetchData')) {
          const mod = req(id) as Record<string, Record<string, unknown>>
          for (const key of Object.keys(mod)) {
            const val = mod[key]
            if (val && typeof val === 'object' && typeof (val as Record<string, unknown>).csrfToken === 'string') {
              return (val as Record<string, unknown>).csrfToken as string
            }
          }
        }
      }
    } catch { /* best-effort */ }
    return ''
  })
}

/**
 * Execute a TikTok internal API call via the page's patched fetch.
 * The fetch interceptor automatically adds X-Bogus, X-Gnarly, msToken,
 * ztca-dpop, and tt-ticket-guard headers — no manual signing needed.
 */
async function internalApiCall(
  page: Page,
  url: string,
  body: Record<string, unknown>,
  errors: Errors,
): Promise<Record<string, unknown>> {
  const csrfToken = await getCsrfToken(page)

  const result = await page.evaluate(
    async (args: { url: string; body: string; csrf: string }) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
        if (args.csrf) headers['tt-csrf-token'] = args.csrf
        const r = await fetch(args.url, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: args.body,
          signal: ctrl.signal,
        })
        const text = await r.text()
        return { status: r.status, text }
      } finally {
        clearTimeout(timer)
      }
    },
    { url, body: new URLSearchParams(body as Record<string, string>).toString(), csrf: csrfToken },
  )

  if (result.status >= 400) throw errors.retriable(`HTTP ${result.status}`)
  try {
    return JSON.parse(result.text) as Record<string, unknown>
  } catch {
    return { success: true }
  }
}

/**
 * Ensure we're on a TikTok page so cookies/signing work for API calls.
 */
async function ensureTikTokPage(page: Page, videoId?: string): Promise<void> {
  const current = page.url()
  if (current.includes('tiktok.com') && !current.startsWith('about:')) return
  const target = videoId ? `${BASE}/video/${videoId}` : `${BASE}/foryou`
  await page.goto(target, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
  await wait(3000)
}

/* ── write ops ───────────────────────────────────────────────── */

async function likeVideo(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  await ensureTikTokPage(page, videoId)
  const data = await internalApiCall(page, `${BASE}/api/commit/item/digg/?aid=1988`, { aweme_id: videoId, type: '1' }, errors)
  return { success: data.status_code === 0, is_digg: 1, ...data }
}

async function unlikeVideo(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  await ensureTikTokPage(page, videoId)
  const data = await internalApiCall(page, `${BASE}/api/commit/item/digg/?aid=1988`, { aweme_id: videoId, type: '0' }, errors)
  return { success: data.status_code === 0, is_digg: 0, ...data }
}

async function followUser(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const userId = String(params.userId || '')
  if (!userId) throw errors.missingParam('userId')
  await ensureTikTokPage(page)
  const data = await internalApiCall(page, `${BASE}/api/commit/follow/user/?aid=1988`, { user_id: userId, type: '1' }, errors)
  return { success: data.status_code === 0, follow_status: 1, ...data }
}

async function unfollowUser(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const userId = String(params.userId || '')
  if (!userId) throw errors.missingParam('userId')
  await ensureTikTokPage(page)
  const data = await internalApiCall(page, `${BASE}/api/commit/follow/user/?aid=1988`, { user_id: userId, type: '0' }, errors)
  return { success: data.status_code === 0, follow_status: 0, ...data }
}

async function bookmarkVideo(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  await ensureTikTokPage(page, videoId)
  const data = await internalApiCall(page, `${BASE}/api/commit/item/collect/?aid=1988`, { aweme_id: videoId, type: '1' }, errors)
  return { success: data.status_code === 0, ...data }
}

async function unbookmarkVideo(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  await ensureTikTokPage(page, videoId)
  const data = await internalApiCall(page, `${BASE}/api/commit/item/collect/?aid=1988`, { aweme_id: videoId, type: '0' }, errors)
  return { success: data.status_code === 0, ...data }
}

async function createComment(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  const text = String(params.text || '')
  if (!text) throw errors.missingParam('text')
  await ensureTikTokPage(page, videoId)
  const data = await internalApiCall(page, `${BASE}/api/comment/publish/?aid=1988`, { aweme_id: videoId, text }, errors)
  return {
    success: data.status_code === 0,
    commentId: (data.comment as Record<string, unknown>)?.cid || '',
    ...data,
  }
}

async function deleteComment(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  const commentId = String(params.commentId || '')
  if (!commentId) throw errors.missingParam('commentId')
  await ensureTikTokPage(page, videoId)
  const data = await internalApiCall(page, `${BASE}/api/comment/delete/?aid=1988`, { aweme_id: videoId, cid: commentId }, errors)
  return { success: data.status_code === 0, ...data }
}

async function likeComment(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  const commentId = String(params.commentId || '')
  if (!commentId) throw errors.missingParam('commentId')
  await ensureTikTokPage(page, videoId)
  const data = await internalApiCall(page, `${BASE}/api/comment/digg/?aid=1988`, { aweme_id: videoId, cid: commentId, type: '1' }, errors)
  return { success: data.status_code === 0, is_digg: 1, ...data }
}

async function unlikeComment(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  const commentId = String(params.commentId || '')
  if (!commentId) throw errors.missingParam('commentId')
  await ensureTikTokPage(page, videoId)
  const data = await internalApiCall(page, `${BASE}/api/comment/digg/?aid=1988`, { aweme_id: videoId, cid: commentId, type: '0' }, errors)
  return { success: data.status_code === 0, is_digg: 0, ...data }
}

async function replyComment(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  const commentId = String(params.commentId || '')
  if (!commentId) throw errors.missingParam('commentId')
  const text = String(params.text || '')
  if (!text) throw errors.missingParam('text')
  await ensureTikTokPage(page, videoId)
  const data = await internalApiCall(page, `${BASE}/api/comment/publish/?aid=1988`, { aweme_id: videoId, text, reply_id: commentId }, errors)
  return {
    success: data.status_code === 0,
    commentId: (data.comment as Record<string, unknown>)?.cid || '',
    ...data,
  }
}

async function blockUser(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const userId = String(params.userId || '')
  if (!userId) throw errors.missingParam('userId')
  await ensureTikTokPage(page)
  const data = await internalApiCall(page, `${BASE}/api/user/block/?aid=1988`, { user_id: userId, source: '3', is_block: '1' }, errors)
  return { success: data.status_code === 0, ...data }
}

async function unblockUser(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const userId = String(params.userId || '')
  if (!userId) throw errors.missingParam('userId')
  await ensureTikTokPage(page)
  const data = await internalApiCall(page, `${BASE}/api/user/block/?aid=1988`, { user_id: userId, source: '3', is_block: '0' }, errors)
  return { success: data.status_code === 0, ...data }
}

/* ── runner export ───────────────────────────────────────────── */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>> = {
  searchVideos,
  searchUsers,
  getVideoDetail,
  getUserProfile,
  getVideoComments,
  getHomeFeed,
  getUserVideos,
  getHashtagDetail,
  getHashtagVideos,
  getRelatedVideos,
  likeVideo,
  unlikeVideo,
  followUser,
  unfollowUser,
  bookmarkVideo,
  unbookmarkVideo,
  createComment,
  deleteComment,
  replyComment,
  likeComment,
  unlikeComment,
  blockUser,
  unblockUser,
  getExplore,
}

const runner: CustomRunner = {
  name: 'tiktok-web',
  description: 'TikTok — reads via API intercept, writes via patched fetch (auto X-Bogus/X-Gnarly signing)',

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('tiktok-web requires a page (transport: page)')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, { ...params }, helpers.errors)
  },
}

export default runner
