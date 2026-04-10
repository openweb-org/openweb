import type { Page } from 'patchright'
/**
 * Weibo L3 adapter — page-based access to Weibo (China Twitter) data.
 *
 * Weibo serves its SPA from weibo.com with internal AJAX APIs at /ajax/*.
 * All operations use page.evaluate() to call these APIs with the browser's
 * cookies and CSRF tokens (XSRF-TOKEN cookie → X-XSRF-TOKEN header).
 *
 * The adapter handles: write operations (CSRF + body encoding),
 * cross-domain requests (s.weibo.com), and all read operations.
 */

type Errors = { unknownOp(op: string): Error; missingParam(name: string): Error; needsLogin(): Error; wrap(err: unknown): Error }

const SITE = 'https://weibo.com'

/* ---------- helpers ---------- */

async function fetchJson(page: Page, url: string): Promise<unknown> {
  return page.evaluate(async (fetchUrl: string) => {
    const res = await fetch(fetchUrl, { credentials: 'include' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }, url)
}

async function postForm(page: Page, url: string, body: string): Promise<unknown> {
  return page.evaluate(async ({ url, body }: { url: string; body: string }) => {
    const xsrf = document.cookie.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith('XSRF-TOKEN='))
    const token = xsrf ? decodeURIComponent(xsrf.split('=')[1]) : ''
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-XSRF-TOKEN': token },
      credentials: 'include',
      body,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }, { url, body })
}

async function postJson(page: Page, url: string, body: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(async ({ url, bodyStr }: { url: string; bodyStr: string }) => {
    const xsrf = document.cookie.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith('XSRF-TOKEN='))
    const token = xsrf ? decodeURIComponent(xsrf.split('=')[1]) : ''
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token },
      credentials: 'include',
      body: bodyStr,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }, { url, bodyStr: JSON.stringify(body) })
}

function buildUrl(base: string, path: string, params: Record<string, unknown>): string {
  const url = new URL(path, base)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

/* ---------- read operations ---------- */

async function getHotSearch(page: Page, _params: Record<string, unknown>, _errors: Errors): Promise<unknown> {
  return fetchJson(page, `${SITE}/ajax/side/hotSearch`)
}

async function getHotFeed(page: Page, params: Record<string, unknown>, _errors: Errors): Promise<unknown> {
  const url = buildUrl(SITE, '/ajax/feed/hottimeline', {
    since_id: params.since_id,
    refresh: params.refresh ?? 4,
    group_id: params.group_id,
    containerid: params.containerid,
    extparam: params.extparam,
    max_id: params.max_id,
    count: params.count ?? 10,
  })
  return fetchJson(page, url)
}

async function getFriendsFeed(page: Page, params: Record<string, unknown>, _errors: Errors): Promise<unknown> {
  const url = buildUrl(SITE, '/ajax/feed/friendstimeline', {
    list_id: params.list_id,
    refresh: params.refresh ?? 4,
    since_id: params.since_id,
    count: params.count ?? 25,
  })
  return fetchJson(page, url)
}

async function getPost(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const id = String(params.id ?? '')
  if (!id) throw errors.missingParam('id')
  const url = buildUrl(SITE, '/ajax/statuses/show', {
    id,
    locale: params.locale ?? 'zh-CN',
    isGetLongText: params.isGetLongText ?? true,
  })
  return fetchJson(page, url)
}

async function getLongtext(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const id = String(params.id ?? '')
  if (!id) throw errors.missingParam('id')
  return fetchJson(page, buildUrl(SITE, '/ajax/statuses/longtext', { id }))
}

async function listComments(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const id = String(params.id ?? '')
  if (!id) throw errors.missingParam('id')
  const url = buildUrl(SITE, '/ajax/statuses/buildComments', {
    id,
    is_reload: params.is_reload ?? 1,
    is_show_bulletin: params.is_show_bulletin ?? 2,
    is_mix: params.is_mix ?? 0,
    count: params.count ?? 20,
    flow: params.flow ?? 0,
    max_id: params.max_id,
    fetch_level: params.fetch_level,
    locale: params.locale,
  })
  return fetchJson(page, url)
}

async function listReposts(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const id = String(params.id ?? '')
  if (!id) throw errors.missingParam('id')
  const url = buildUrl(SITE, '/ajax/statuses/repostTimeline', {
    id,
    page: params.page ?? 1,
    count: params.count ?? 10,
  })
  return fetchJson(page, url)
}

async function getUserProfile(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const uid = String(params.uid ?? '')
  if (!uid) throw errors.missingParam('uid')
  return fetchJson(page, buildUrl(SITE, '/ajax/profile/info', { uid, scene: params.scene }))
}

async function getUserDetail(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const uid = String(params.uid ?? '')
  if (!uid) throw errors.missingParam('uid')
  return fetchJson(page, buildUrl(SITE, '/ajax/profile/detail', { uid }))
}

async function getUserStatuses(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const uid = String(params.uid ?? '')
  if (!uid) throw errors.missingParam('uid')
  const url = buildUrl(SITE, '/ajax/statuses/mymblog', {
    uid,
    page: params.page ?? 1,
    feature: params.feature ?? 0,
    since_id: params.since_id,
  })
  return fetchJson(page, url)
}

/* ---------- write operations ---------- */

async function likePost(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const id = String(params.id ?? '')
  if (!id) throw errors.missingParam('id')
  return postForm(page, `${SITE}/ajax/statuses/setLike`, `id=${id}`)
}

async function repost(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const id = String(params.id ?? '')
  if (!id) throw errors.missingParam('id')
  const reason = String(params.reason ?? '转发微博')
  return postJson(page, `${SITE}/ajax/statuses/repost`, { id, reason })
}

async function followUser(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const uid = String(params.friend_uid ?? params.uid ?? '')
  if (!uid) throw errors.missingParam('friend_uid')
  return postForm(page, `${SITE}/ajax/friendships/create`, `friend_uid=${uid}`)
}

async function bookmarkPost(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const id = String(params.id ?? '')
  if (!id) throw errors.missingParam('id')
  return postForm(page, `${SITE}/ajax/statuses/createFavorites`, `id=${id}`)
}

async function unlikePost(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const id = String(params.id ?? '')
  if (!id) throw errors.missingParam('id')
  return postForm(page, `${SITE}/ajax/statuses/cancelLike`, `id=${id}`)
}

async function unfollowUser(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const uid = String(params.friend_uid ?? params.uid ?? '')
  if (!uid) throw errors.missingParam('friend_uid')
  return postForm(page, `${SITE}/ajax/friendships/destroy`, `friend_uid=${uid}`)
}

async function unbookmarkPost(page: Page, params: Record<string, unknown>, errors: Errors): Promise<unknown> {
  const id = String(params.id ?? '')
  if (!id) throw errors.missingParam('id')
  return postForm(page, `${SITE}/ajax/statuses/destroyFavorites`, `id=${id}`)
}

/* ---------- adapter export ---------- */

type OpHandler = (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  // Feeds
  getFriendsFeed,
  getHotFeed,
  // Trending
  getHotSearch,
  // Users
  getUserProfile,
  getUserDetail,
  getUserStatuses,
  // Posts
  getPost,
  getLongtext,
  listComments,
  listReposts,
  // Write
  likePost,
  repost,
  followUser,
  bookmarkPost,
  unlikePost,
  unfollowUser,
  unbookmarkPost,
}

const adapter = {
  name: 'weibo-web',
  description: 'Weibo — trending topics, feeds, posts, comments, user profiles, search, write ops via AJAX APIs',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('weibo.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://weibo.com')
    return cookies.some((c) => c.name === 'SUB' || c.name === 'XSRF-TOKEN')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: Record<string, unknown>): Promise<unknown> {
    const { errors } = helpers as { errors: Errors }
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw errors.unknownOp(operation)
      return handler(page, { ...params }, errors)
    } catch (error) {
      throw errors.wrap(error)
    }
  },
}

export default adapter
