import type { Page } from 'patchright'
import type { CodeAdapter } from '../../../types/adapter.js'

const BASE = 'https://substack.com'

async function apiFetch(
  page: Page,
  path: string,
): Promise<unknown> {
  const result = await page.evaluate(
    async (p: string) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      try {
        const r = await fetch(p, { credentials: 'same-origin', signal: ctrl.signal })
        return { status: r.status, text: await r.text() }
      } finally {
        clearTimeout(timer)
      }
    },
    path,
  )

  if (result.status >= 400) {
    const err = Object.assign(new Error(`HTTP ${result.status}`), { failureClass: 'fatal' })
    throw err
  }

  return JSON.parse(result.text)
}

async function ensureSubdomain(page: Page, subdomain: string): Promise<void> {
  const current = page.url()
  if (!current.includes(subdomain)) {
    await page.goto(`https://${subdomain}.substack.com/`, { waitUntil: 'load', timeout: 30_000 })
    await new Promise((r) => setTimeout(r, 2000))
  }
}

async function ensureSubstack(page: Page): Promise<void> {
  const host = new URL(page.url()).hostname
  if (host !== 'substack.com') {
    await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 30_000 })
    await new Promise((r) => setTimeout(r, 2000))
  }
}

/* --- operations --- */

async function searchPosts(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await ensureSubstack(page)
  const query = encodeURIComponent(String(params.query ?? ''))
  const pg = Number(params.page ?? 0)
  return apiFetch(page, `/api/v1/post/search?query=${query}&page=${pg}`)
}

async function getArchive(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const sub = String(params.subdomain ?? '')
  await ensureSubdomain(page, sub)
  const sort = String(params.sort ?? 'new')
  const search = encodeURIComponent(String(params.search ?? ''))
  const offset = Number(params.offset ?? 0)
  const limit = Number(params.limit ?? 12)
  return apiFetch(page, `/api/v1/archive?sort=${sort}&search=${search}&offset=${offset}&limit=${limit}`)
}

async function getPost(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const sub = String(params.subdomain ?? '')
  const slug = String(params.slug ?? '')
  await ensureSubdomain(page, sub)
  return apiFetch(page, `/api/v1/posts/${encodeURIComponent(slug)}`)
}

async function getPostComments(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const sub = String(params.subdomain ?? '')
  const postId = String(params.postId ?? '')
  const allComments = params.all_comments !== false
  const sort = String(params.sort ?? 'best_first')
  await ensureSubdomain(page, sub)
  return apiFetch(page, `/api/v1/post/${postId}/comments?token=&all_comments=${allComments}&sort=${sort}`)
}

async function getTrending(page: Page, params: Record<string, unknown>): Promise<unknown> {
  await ensureSubstack(page)
  const limit = Number(params.limit ?? 25)
  return apiFetch(page, `/api/v1/trending?limit=${limit}`)
}

/* --- adapter export --- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchPosts,
  getArchive,
  getPost,
  getPostComments,
  getTrending,
}

const adapter: CodeAdapter = {
  name: 'substack-api',
  description: 'Substack REST API — search posts, publication archives, post detail, comments, trending',

  async init(page: Page): Promise<boolean> {
    return true
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) {
      const err = Object.assign(new Error(`Unknown operation: ${operation}`), { failureClass: 'fatal' })
      throw err
    }
    return handler(page, { ...params })
  },
}

export default adapter
