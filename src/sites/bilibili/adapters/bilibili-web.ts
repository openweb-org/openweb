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
import type { Page, Response as PwResponse } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'

const API_BASE = 'https://api.bilibili.com'

/* ---------- helpers ---------- */

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

async function getRanking(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const rid = Number(params.rid ?? 0)
  const type = String(params.type ?? 'all')

  return interceptApiResponse(
    page,
    '/x/web-interface/ranking/v2',
    `https://www.bilibili.com/v/popular/rank/all`,
  ).catch(async () => {
    return fetchApiViaPage(page, '/x/web-interface/ranking/v2', { rid, type })
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

async function getUserFollowStats(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const vmid = Number(params.vmid ?? params.mid)
  if (!vmid) throw OpenWebError.missingParam('vmid')

  return fetchApiViaPage(page, '/x/relation/stat', { vmid })
}

async function getUploaderStats(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const mid = Number(params.mid)
  if (!mid) throw OpenWebError.missingParam('mid')

  return fetchApiViaPage(page, '/x/space/upstat', { mid })
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

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchVideos,
  getVideoDetail,
  getPopularVideos,
  getRanking,
  getVideoComments,
  getUserInfo,
  getUserFollowStats,
  getUploaderStats,
  getUserVideos,
  getRecommendedFeed,
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
