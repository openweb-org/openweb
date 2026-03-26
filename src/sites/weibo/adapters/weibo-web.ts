/**
 * Weibo L3 adapter — page-based access to Weibo (China Twitter) data.
 *
 * Weibo serves its SPA from weibo.com with internal AJAX APIs at /ajax/*.
 * All operations use page.evaluate() to call these APIs with the browser's
 * cookies and CSRF tokens (XSRF-TOKEN cookie → X-XSRF-TOKEN header).
 *
 * Search uses s.weibo.com which returns server-rendered HTML — we extract
 * structured data from the page's embedded JSON.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
import type { Page } from 'playwright-core'

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

/* ---------- operations ---------- */

async function getHotSearch(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  const data = await fetchJson(page, `${SITE}/ajax/side/hotSearch`) as Record<string, unknown>
  return data
}

async function getSearchBand(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  const url = buildUrl(SITE, '/ajax/side/searchBand', {})
  const data = await fetchJson(page, url) as Record<string, unknown>
  return data
}

async function getHotTimeline(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const url = buildUrl(SITE, '/ajax/feed/hottimeline', {
    since_id: params.since_id,
    refresh: params.refresh ?? 4,
    group_id: params.group_id,
    containerid: params.containerid,
    extparam: params.extparam,
    max_id: params.max_id,
    count: params.count ?? 10,
  })
  const data = await fetchJson(page, url) as Record<string, unknown>
  return data
}

async function getPostDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const id = String(params.id ?? '')
  if (!id) throw OpenWebError.missingParam('id')
  const url = buildUrl(SITE, '/ajax/statuses/show', {
    id,
    locale: params.locale ?? 'en-US',
    isGetLongText: params.isGetLongText ?? true,
  })
  const data = await fetchJson(page, url) as Record<string, unknown>
  return data
}

async function getPostComments(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const id = String(params.id ?? '')
  if (!id) throw OpenWebError.missingParam('id')
  const url = buildUrl(SITE, '/ajax/statuses/buildComments', {
    id,
    is_reload: params.is_reload ?? 1,
    is_show_bulletin: params.is_show_bulletin ?? 2,
    is_mix: params.is_mix ?? 0,
    count: params.count ?? 20,
    flow: params.flow ?? 0,
    max_id: params.max_id,
  })
  const data = await fetchJson(page, url) as Record<string, unknown>
  return data
}

async function getUserProfile(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const uid = String(params.uid ?? '')
  if (!uid) throw OpenWebError.missingParam('uid')
  const url = buildUrl(SITE, '/ajax/profile/info', { uid })
  const data = await fetchJson(page, url) as Record<string, unknown>
  return data
}

async function getUserDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const uid = String(params.uid ?? '')
  if (!uid) throw OpenWebError.missingParam('uid')
  const url = buildUrl(SITE, '/ajax/profile/detail', { uid })
  const data = await fetchJson(page, url) as Record<string, unknown>
  return data
}

async function getUserTimeline(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const uid = String(params.uid ?? '')
  if (!uid) throw OpenWebError.missingParam('uid')
  const url = buildUrl(SITE, '/ajax/statuses/mymblog', {
    uid,
    page: params.page ?? 1,
    feature: params.feature ?? 0,
    since_id: params.since_id,
  })
  const data = await fetchJson(page, url) as Record<string, unknown>
  return data
}

async function searchPosts(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const q = String(params.q ?? '')
  if (!q) throw OpenWebError.missingParam('q')
  const url = buildUrl(SITE, '/ajax/side/search', { q })
  const data = await fetchJson(page, url) as Record<string, unknown>
  return data
}

async function getIndexBand(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const url = buildUrl('https://s.weibo.com', '/ajax_Indexband/getIndexBand', {
    type: params.type ?? 0,
  })
  const data = await fetchJson(page, url) as Record<string, unknown>
  return data
}

/* ---------- write operations ---------- */

async function likePost(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const id = String(params.id ?? '')
  if (!id) throw OpenWebError.missingParam('id')
  return postForm(page, `${SITE}/ajax/statuses/setLike`, `id=${id}`)
}

async function repost(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const id = String(params.id ?? '')
  if (!id) throw OpenWebError.missingParam('id')
  const reason = String(params.reason ?? '转发微博')
  return postJson(page, `${SITE}/ajax/statuses/repost`, { id, reason })
}

async function followUser(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const uid = String(params.friend_uid ?? params.uid ?? '')
  if (!uid) throw OpenWebError.missingParam('friend_uid')
  return postForm(page, `${SITE}/ajax/friendships/create`, `friend_uid=${uid}`)
}

async function bookmarkPost(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const id = String(params.id ?? '')
  if (!id) throw OpenWebError.missingParam('id')
  return postForm(page, `${SITE}/ajax/statuses/createFavorites`, `id=${id}`)
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  getHotSearch,
  getSearchBand,
  getHotTimeline,
  getPostDetail,
  getPostComments,
  getUserProfile,
  getUserDetail,
  getUserTimeline,
  searchPosts,
  getIndexBand,
  likePost,
  repost,
  followUser,
  bookmarkPost,
}

const adapter: CodeAdapter = {
  name: 'weibo-web',
  description: 'Weibo — trending topics, post detail, comments, user profiles, search via AJAX APIs',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('weibo.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://weibo.com')
    return cookies.some((c) => c.name === 'SUB' || c.name === 'XSRF-TOKEN')
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
