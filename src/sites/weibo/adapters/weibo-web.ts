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
  if (!id) throw new Error('id is required')
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
  if (!id) throw new Error('id (post mid) is required')
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
  if (!uid) throw new Error('uid is required')
  const url = buildUrl(SITE, '/ajax/profile/info', { uid })
  const data = await fetchJson(page, url) as Record<string, unknown>
  return data
}

async function getUserDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const uid = String(params.uid ?? '')
  if (!uid) throw new Error('uid is required')
  const url = buildUrl(SITE, '/ajax/profile/detail', { uid })
  const data = await fetchJson(page, url) as Record<string, unknown>
  return data
}

async function getUserTimeline(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const uid = String(params.uid ?? '')
  if (!uid) throw new Error('uid is required')
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
  if (!q) throw new Error('q (search query) is required')
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
    const handler = OPERATIONS[operation]
    if (!handler) throw new Error(`Unknown operation: ${operation}`)
    return handler(page, { ...params })
  },
}

export default adapter
