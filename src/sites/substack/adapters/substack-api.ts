import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
/**
 * Substack L3 adapter — REST API via browser fetch.
 *
 * Substack serves data through REST endpoints at /api/v1/*.
 * The main site (substack.com) has search, categories, and discovery.
 * Individual publications have their own subdomains with archive/post APIs.
 * All read operations work without auth.
 */
import type { CodeAdapter } from '../../../types/adapter.js'

const BASE_URL = 'https://substack.com'

/* ---------- browser fetch helper ---------- */

async function apiFetch(
  page: Page,
  url: string,
  method = 'GET',
  body?: unknown,
): Promise<unknown> {
  const result = await page.evaluate(
    async (args: { url: string; method: string; body?: string }) => {
      const opts: RequestInit = {
        method: args.method,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      }
      if (args.body) opts.body = args.body
      const resp = await fetch(args.url, opts)
      return { status: resp.status, text: await resp.text() }
    },
    { url, method, body: body ? JSON.stringify(body) : undefined },
  )

  if (result.status >= 400) {
    throw OpenWebError.httpError(result.status)
  }

  return JSON.parse(result.text)
}

/* ---------- ensure page is on substack.com ---------- */

async function ensureSubstackContext(page: Page): Promise<void> {
  const currentUrl = page.url()
  if (!currentUrl.includes('substack.com')) {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 15000 })
  }
}

/* ---------- operation handlers ---------- */

async function searchPosts(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await ensureSubstackContext(page)
  const query = String(params.query ?? params.q ?? '')
  const offset = Number(params.offset ?? 0)
  const limit = Number(params.limit ?? 25)

  const data = await apiFetch(
    page,
    `${BASE_URL}/api/v1/post/search`,
    'POST',
    { query, offset, limit },
  )

  return data
}

async function searchPublications(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await ensureSubstackContext(page)
  const query = String(params.query ?? params.q ?? '')
  const offset = Number(params.offset ?? 0)
  const limit = Number(params.limit ?? 25)

  const data = await apiFetch(
    page,
    `${BASE_URL}/api/v1/publication/search`,
    'POST',
    { query, offset, limit },
  )

  return data
}

async function searchPeople(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await ensureSubstackContext(page)
  const query = String(params.query ?? params.q ?? '')
  const offset = Number(params.offset ?? 0)
  const limit = Number(params.limit ?? 25)

  const data = await apiFetch(
    page,
    `${BASE_URL}/api/v1/search/profiles`,
    'POST',
    { query, offset, limit },
  )

  return data
}

async function getCategories(page: Page): Promise<unknown> {
  await ensureSubstackContext(page)
  return apiFetch(page, `${BASE_URL}/api/v1/category/public/all`)
}

async function getCategoryNewsletters(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await ensureSubstackContext(page)
  const categorySlug = String(params.categorySlug ?? params.category ?? '')
  const page_num = Number(params.page ?? 1)
  const paid = params.paid === true ? 'paid' : 'free'

  return apiFetch(
    page,
    `${BASE_URL}/api/v1/category/public/${encodeURIComponent(categorySlug)}/${paid}?page=${page_num}`,
  )
}

async function getLeaderboard(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await ensureSubstackContext(page)
  const page_num = Number(params.page ?? 1)

  return apiFetch(
    page,
    `${BASE_URL}/api/v1/category/public/all/paid?page=${page_num}`,
  )
}

async function getPublicationArchive(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const subdomain = String(params.subdomain ?? params.publication ?? '')
  const offset = Number(params.offset ?? 0)
  const limit = Number(params.limit ?? 12)
  const sort = String(params.sort ?? 'new')

  const pubUrl = `https://${subdomain}.substack.com`
  if (!page.url().includes(subdomain)) {
    await page.goto(pubUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
  }

  return apiFetch(
    page,
    `${pubUrl}/api/v1/archive?sort=${sort}&search=&offset=${offset}&limit=${limit}`,
  )
}

async function getPost(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const subdomain = String(params.subdomain ?? params.publication ?? '')
  const slug = String(params.slug ?? '')

  const pubUrl = `https://${subdomain}.substack.com`
  if (!page.url().includes(subdomain)) {
    await page.goto(pubUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
  }

  return apiFetch(page, `${pubUrl}/api/v1/posts/${slug}`)
}

async function getPostComments(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const subdomain = String(params.subdomain ?? params.publication ?? '')
  const postId = String(params.postId ?? params.id ?? '')
  const token = String(params.token ?? '')
  const all_comments = params.all_comments !== false

  const pubUrl = `https://${subdomain}.substack.com`
  if (!page.url().includes(subdomain)) {
    await page.goto(pubUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
  }

  const url = `${pubUrl}/api/v1/post/${postId}/comments?token=${token}&all_comments=${all_comments}`
  return apiFetch(page, url)
}

async function getAuthorProfile(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await ensureSubstackContext(page)
  const handle = String(params.handle ?? params.username ?? '')

  // Navigate to profile page and extract data from rendered DOM
  await page.goto(`${BASE_URL}/@${handle}`, { waitUntil: 'networkidle', timeout: 20000 })
  await page.waitForTimeout(2000)

  const profile = await page.evaluate(() => {
    const nameEl = document.querySelector('h1, h2, [class*="profile-name"]')
    const bioEl = document.querySelector('[class*="profile-bio"], [class*="about-description"]')
    const imgEl = document.querySelector('img[src*="substackcdn.com"][class*="profile"], img[src*="substackcdn.com"][class*="avatar"]')
    const followers = Array.from(document.querySelectorAll('a, span, div')).find(
      (el) => el.textContent?.match(/\d+\s*(subscriber|follower)/i),
    )

    // Get associated publications
    const pubLinks = Array.from(document.querySelectorAll('a[href*=".substack.com"], a[href*="substack.com/@"]'))
      .slice(0, 5)
      .map((el) => ({
        name: el.textContent?.trim() ?? '',
        url: el.getAttribute('href') ?? '',
      }))
      .filter((p) => p.name)

    return {
      name: nameEl?.textContent?.trim() ?? '',
      bio: bioEl?.textContent?.trim() ?? '',
      imageUrl: imgEl?.getAttribute('src') ?? '',
      subscriberInfo: followers?.textContent?.trim() ?? '',
      publications: pubLinks,
    }
  })

  return { handle, ...profile }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchPosts,
  searchPublications,
  searchPeople,
  getCategories,
  getCategoryNewsletters,
  getLeaderboard,
  getPublicationArchive,
  getPost,
  getPostComments,
  getAuthorProfile,
}

const adapter: CodeAdapter = {
  name: 'substack-api',
  description: 'Substack REST API — newsletters, articles, search, categories, profiles',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('substack.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://substack.com')
    return cookies.some((c) => c.name === 'substack.sid')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) {
        throw OpenWebError.unknownOp(operation)
      }
      return await handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
