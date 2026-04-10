import type { Page, Response as PwResponse } from 'patchright'

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
  wrap(error: unknown): Error
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BASE = 'https://www.tiktok.com'

/**
 * Extract TikTok's SSR hydration data from __UNIVERSAL_DATA_FOR_REHYDRATION__.
 * This global contains pre-rendered page data including video details, user profiles, etc.
 */
async function extractSSRData(page: Page, scope: string): Promise<Record<string, unknown> | null> {
  return page.evaluate((s: string) => {
    const w = window as Window & { __UNIVERSAL_DATA_FOR_REHYDRATION__?: Record<string, unknown> }
    const root = w.__UNIVERSAL_DATA_FOR_REHYDRATION__
    if (!root) return null
    const defaultScope = root.__DEFAULT_SCOPE__ as Record<string, unknown> | undefined
    if (!defaultScope) return null
    return (defaultScope[s] as Record<string, unknown>) ?? null
  }, scope)
}

/* ---------- getVideoDetail ---------- */

async function getVideoDetail(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  const username = String(params.username || '')
  if (!username) throw errors.missingParam('username')

  const handle = username.startsWith('@') ? username : `@${username}`
  const url = `${BASE}/${handle}/video/${videoId}`

  await page.goto(url, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
  await wait(3000)

  // Try SSR data first
  const ssrData = await extractSSRData(page, 'webapp.video-detail')
  if (ssrData) {
    const itemInfo = ssrData.itemInfo as Record<string, unknown> | undefined
    const itemStruct = (itemInfo?.itemStruct ?? ssrData.itemStruct) as Record<string, unknown> | undefined
    if (itemStruct) {
      return normalizeVideoItem(itemStruct)
    }
  }

  // Fallback: extract from DOM + meta tags
  return page.evaluate(() => {
    const getMeta = (name: string) =>
      document.querySelector(`meta[property="${name}"]`)?.getAttribute('content') ||
      document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || ''

    return {
      id: window.location.pathname.split('/video/')[1] || '',
      description: getMeta('og:description') || document.querySelector('[data-e2e="browse-video-desc"]')?.textContent?.trim() || '',
      title: getMeta('og:title') || '',
      author: {
        uniqueId: window.location.pathname.split('/')[1]?.replace('@', '') || '',
        nickname: getMeta('og:title')?.split(' |')[0] || '',
      },
      video: {
        cover: getMeta('og:image') || '',
        url: getMeta('og:video:secure_url') || getMeta('og:video') || '',
      },
    }
  })
}

function normalizeVideoItem(item: Record<string, unknown>): Record<string, unknown> {
  const video = (item.video || {}) as Record<string, unknown>
  const author = (item.author || {}) as Record<string, unknown>
  const music = (item.music || {}) as Record<string, unknown>
  const stats = (item.stats || {}) as Record<string, unknown>
  const challenges = (item.challenges || []) as Array<Record<string, unknown>>

  return {
    id: item.id || '',
    description: item.desc || '',
    createTime: item.createTime || null,
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
      diggCount: stats.diggCount ?? stats.likeCount ?? 0,
      shareCount: stats.shareCount ?? 0,
      commentCount: stats.commentCount ?? 0,
      playCount: stats.playCount ?? 0,
      collectCount: stats.collectCount ?? 0,
    },
    challenges: challenges.map((c) => ({
      id: c.id || '',
      title: c.title || '',
      desc: c.desc || '',
    })),
  }
}

/* ---------- getUserProfile ---------- */

async function getUserProfile(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const username = String(params.username || '')
  if (!username) throw errors.missingParam('username')

  const handle = username.startsWith('@') ? username : `@${username}`
  const url = `${BASE}/${handle}`

  await page.goto(url, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
  await wait(3000)

  // Try SSR data
  const ssrData = await extractSSRData(page, 'webapp.user-detail')
  if (ssrData) {
    const userInfo = (ssrData.userInfo || ssrData) as Record<string, unknown>
    const user = (userInfo.user || {}) as Record<string, unknown>
    const userStats = (userInfo.stats || {}) as Record<string, unknown>

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
        followerCount: userStats.followerCount ?? 0,
        followingCount: userStats.followingCount ?? 0,
        heartCount: userStats.heartCount ?? userStats.heart ?? 0,
        videoCount: userStats.videoCount ?? 0,
        diggCount: userStats.diggCount ?? 0,
      },
    }
  }

  // Fallback: DOM extraction
  return page.evaluate(() => {
    const getMeta = (name: string) =>
      document.querySelector(`meta[property="${name}"]`)?.getAttribute('content') ||
      document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || ''

    const statEls = document.querySelectorAll('[data-e2e="followers-count"], [data-e2e="following-count"], [data-e2e="likes-count"]')
    const statValues: string[] = [...statEls].map((el) => el.getAttribute('title') || el.textContent?.trim() || '0')

    return {
      uniqueId: window.location.pathname.replace(/^\/+@?/, '').replace(/\/+$/, ''),
      nickname: getMeta('og:title')?.replace(/ \(@.*/, '') || '',
      signature: document.querySelector('[data-e2e="user-bio"]')?.textContent?.trim() || getMeta('og:description') || '',
      avatarThumb: getMeta('og:image') || '',
      verified: !!document.querySelector('[data-e2e="verify-badge"]'),
      stats: {
        followerCount: statValues[0] || '0',
        followingCount: statValues[1] || '0',
        heartCount: statValues[2] || '0',
      },
    }
  })
}

/* ---------- getVideoComments ---------- */

async function getVideoComments(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  const username = String(params.username || '')
  if (!username) throw errors.missingParam('username')

  const handle = username.startsWith('@') ? username : `@${username}`
  const url = `${BASE}/${handle}/video/${videoId}`

  // Intercept the comments API response
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
    await wait(4000)

    // Scroll down to trigger comment loading if needed
    await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {})
    await wait(3000)

    const deadline = Date.now() + 15_000
    while (!captured && Date.now() < deadline) {
      await wait(500)
    }
  } finally {
    page.off('response', handler)
  }

  if (!captured) {
    // Fallback: try SSR data for comments
    const ssrData = await extractSSRData(page, 'webapp.video-detail')
    if (ssrData) {
      const comments = ssrData.commentList as Array<Record<string, unknown>> | undefined
      if (comments) {
        return {
          comments: comments.map(normalizeComment),
          total: comments.length,
          hasMore: false,
        }
      }
    }
    return { comments: [], total: 0, hasMore: false }
  }

  const data = captured as Record<string, unknown>
  const commentsList = (data.comments || []) as Array<Record<string, unknown>>
  return {
    comments: commentsList.map(normalizeComment),
    total: data.total || commentsList.length,
    cursor: data.cursor || 0,
    hasMore: data.has_more === 1 || data.has_more === true,
  }
}

function normalizeComment(c: Record<string, unknown>): Record<string, unknown> {
  const user = (c.user || {}) as Record<string, unknown>
  return {
    id: c.cid || c.id || '',
    text: c.text || '',
    createTime: c.create_time || c.createTime || null,
    diggCount: c.digg_count ?? c.diggCount ?? 0,
    replyCount: c.reply_comment_total ?? c.replyCount ?? 0,
    author: {
      id: user.uid || user.id || '',
      uniqueId: user.unique_id || user.uniqueId || '',
      nickname: user.nickname || '',
      avatarThumb: user.avatar_thumb?.url_list?.[0] || user.avatarThumb || '',
    },
  }
}

/* ---------- getHomeFeed ---------- */

async function getHomeFeed(page: Page, _params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  // Intercept the recommend API response
  let captured: unknown = null
  const handler = async (resp: PwResponse) => {
    if (captured) return
    const rUrl = resp.url()
    if (rUrl.includes('/api/recommend/item_list/') || rUrl.includes('/api/post/item_list/')) {
      try { captured = await resp.json() } catch { /* ignore */ }
    }
  }

  page.on('response', handler)
  try {
    await page.goto(`${BASE}/foryou`, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
    await wait(4000)

    const deadline = Date.now() + 15_000
    while (!captured && Date.now() < deadline) {
      await wait(500)
    }
  } finally {
    page.off('response', handler)
  }

  if (captured) {
    const data = captured as Record<string, unknown>
    const items = (data.itemList || data.items || []) as Array<Record<string, unknown>>
    return {
      items: items.map(normalizeVideoItem),
      hasMore: data.hasMore === true || data.has_more === 1,
    }
  }

  // Fallback: SSR data
  const ssrData = await extractSSRData(page, 'webapp.browse-detail')
    ?? await extractSSRData(page, 'webapp.video-feed')
    ?? await extractSSRData(page, 'webapp.recommend-detail')
  if (ssrData) {
    const itemList = (ssrData.itemList || ssrData.items || []) as Array<Record<string, unknown>>
    return {
      items: itemList.map(normalizeVideoItem),
      hasMore: false,
    }
  }

  // Final fallback: DOM extraction
  const items = await page.evaluate(() => {
    const videos: Array<Record<string, unknown>> = []
    const cards = document.querySelectorAll('[data-e2e="recommend-list-item-container"], [class*="DivItemContainer"]')
    for (const card of cards) {
      const link = card.querySelector('a[href*="/video/"]') as HTMLAnchorElement | null
      const desc = card.querySelector('[data-e2e="video-desc"], [class*="DivVideoCaption"]')?.textContent?.trim() || ''
      const author = card.querySelector('[data-e2e="video-author-uniqueid"]')?.textContent?.trim() || ''
      if (link) {
        const href = link.getAttribute('href') || ''
        const idMatch = href.match(/\/video\/(\d+)/)
        videos.push({
          id: idMatch?.[1] || '',
          description: desc,
          url: href,
          author: { uniqueId: author },
        })
      }
    }
    return videos
  })

  return { items, hasMore: false }
}

/* ---------- write helpers ---------- */

/**
 * Execute a TikTok internal API call via page context.
 * TikTok's signing (X-Bogus, X-Gnarly) is computed client-side,
 * so we must call from within the browser via fetch.
 */
async function internalApiCall(
  page: Page,
  url: string,
  body: Record<string, unknown>,
  errors: Errors,
): Promise<Record<string, unknown>> {
  const result = await page.evaluate(
    async (args: { url: string; body: string }) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      try {
        const r = await fetch(args.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
    { url, body: new URLSearchParams(body as Record<string, string>).toString() },
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
 * Navigates to the video page if a videoId is provided, otherwise /foryou.
 */
async function ensureTikTokPage(page: Page, videoId?: string): Promise<void> {
  const current = page.url()
  if (current.includes('tiktok.com') && !current.startsWith('about:')) return
  const target = videoId ? `${BASE}/video/${videoId}` : `${BASE}/foryou`
  await page.goto(target, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
  await wait(3000)
}

/* ---------- likeVideo / unlikeVideo ---------- */

async function likeVideo(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')

  await ensureTikTokPage(page, videoId)
  const data = await internalApiCall(
    page,
    `${BASE}/api/commit/item/digg/?aid=1988`,
    { aweme_id: videoId, type: '1' },
    errors,
  )
  return { success: data.status_code === 0, is_digg: 1, ...data }
}

async function unlikeVideo(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')

  await ensureTikTokPage(page, videoId)
  const data = await internalApiCall(
    page,
    `${BASE}/api/commit/item/digg/?aid=1988`,
    { aweme_id: videoId, type: '0' },
    errors,
  )
  return { success: data.status_code === 0, is_digg: 0, ...data }
}

/* ---------- followUser / unfollowUser ---------- */

async function followUser(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const userId = String(params.userId || '')
  if (!userId) throw errors.missingParam('userId')

  await ensureTikTokPage(page)
  const data = await internalApiCall(
    page,
    `${BASE}/api/commit/follow/user/?aid=1988`,
    { user_id: userId, type: '1' },
    errors,
  )
  return { success: data.status_code === 0, follow_status: 1, ...data }
}

async function unfollowUser(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const userId = String(params.userId || '')
  if (!userId) throw errors.missingParam('userId')

  await ensureTikTokPage(page)
  const data = await internalApiCall(
    page,
    `${BASE}/api/commit/follow/user/?aid=1988`,
    { user_id: userId, type: '0' },
    errors,
  )
  return { success: data.status_code === 0, follow_status: 0, ...data }
}

/* ---------- bookmarkVideo / unbookmarkVideo ---------- */

async function bookmarkVideo(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')

  await ensureTikTokPage(page, videoId)
  const data = await internalApiCall(
    page,
    `${BASE}/api/commit/item/collect/?aid=1988`,
    { aweme_id: videoId, type: '1' },
    errors,
  )
  return { success: data.status_code === 0, ...data }
}

async function unbookmarkVideo(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')

  await ensureTikTokPage(page, videoId)
  const data = await internalApiCall(
    page,
    `${BASE}/api/commit/item/collect/?aid=1988`,
    { aweme_id: videoId, type: '0' },
    errors,
  )
  return { success: data.status_code === 0, ...data }
}

/* ---------- createComment / deleteComment ---------- */

async function createComment(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const videoId = String(params.videoId || '')
  if (!videoId) throw errors.missingParam('videoId')
  const text = String(params.text || '')
  if (!text) throw errors.missingParam('text')

  await ensureTikTokPage(page, videoId)
  const data = await internalApiCall(
    page,
    `${BASE}/api/comment/publish/?aid=1988`,
    { aweme_id: videoId, text },
    errors,
  )
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
  const data = await internalApiCall(
    page,
    `${BASE}/api/comment/delete/?aid=1988`,
    { aweme_id: videoId, cid: commentId },
    errors,
  )
  return { success: data.status_code === 0, ...data }
}

/* ---------- getExplore ---------- */

async function getExplore(page: Page, _params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  let captured: unknown = null
  const handler = async (resp: PwResponse) => {
    if (captured) return
    const rUrl = resp.url()
    if (rUrl.includes('/api/explore/item_list/') || rUrl.includes('/api/recommend/item_list/')) {
      try { captured = await resp.json() } catch { /* ignore */ }
    }
  }

  page.on('response', handler)
  try {
    await page.goto(`${BASE}/explore`, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
    await wait(4000)

    const deadline = Date.now() + 15_000
    while (!captured && Date.now() < deadline) {
      await wait(500)
    }
  } finally {
    page.off('response', handler)
  }

  if (captured) {
    const data = captured as Record<string, unknown>
    const items = (data.itemList || data.items || []) as Array<Record<string, unknown>>
    return {
      items: items.map(normalizeVideoItem),
      hasMore: data.hasMore === true || data.has_more === 1,
    }
  }

  // Fallback: SSR extraction
  const ssrData = await extractSSRData(page, 'webapp.explore')
    ?? await extractSSRData(page, 'webapp.discover')
  if (ssrData) {
    const itemList = (ssrData.itemList || ssrData.items || []) as Array<Record<string, unknown>>
    return { items: itemList.map(normalizeVideoItem), hasMore: false }
  }

  // Final fallback: DOM extraction
  const items = await page.evaluate(() => {
    const videos: Array<Record<string, unknown>> = []
    const cards = document.querySelectorAll('[data-e2e="explore-item"], [class*="DivItemContainer"], a[href*="/video/"]')
    for (const card of cards) {
      const link = card.closest('a[href*="/video/"]') || card.querySelector('a[href*="/video/"]')
      if (!link) continue
      const href = link.getAttribute('href') || ''
      const idMatch = href.match(/\/video\/(\d+)/)
      const desc = card.querySelector('[class*="Caption"], [class*="desc"]')?.textContent?.trim() || ''
      const author = href.match(/@([^/]+)/)?.[1] || ''
      videos.push({
        id: idMatch?.[1] || '',
        description: desc,
        author: { uniqueId: author },
      })
    }
    return videos
  })

  return { items, hasMore: false }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>> = {
  getVideoDetail,
  getUserProfile,
  getVideoComments,
  getHomeFeed,
  likeVideo,
  unlikeVideo,
  followUser,
  unfollowUser,
  bookmarkVideo,
  unbookmarkVideo,
  createComment,
  deleteComment,
  getExplore,
}

const adapter = {
  name: 'tiktok-web',
  description: 'TikTok — read (detail, profile, comments, feed, explore) + write (like, follow, bookmark, comment) via page transport',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('tiktok.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: { errors: Errors },
  ): Promise<unknown> {
    const { errors } = helpers
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page, { ...params }, errors)
  },
}

export default adapter
