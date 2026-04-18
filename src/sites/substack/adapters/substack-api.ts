import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

/**
 * Substack adapter — same-origin, relative-path browser fetch.
 *
 * Publication subdomains load the DataDog RUM script which monkey-patches
 * window.fetch. The runtime's generic browser-fetch path uses absolute URLs
 * with credentials:'include' and trips a `TypeError: Failed to fetch` from
 * inside the wrapper. Issuing the fetch with a same-origin relative path
 * sidesteps that wrapper, so the adapter navigates to the publication
 * subdomain (or substack.com for the search op) and runs page.evaluate(fetch).
 */

const BASE = 'https://substack.com'

interface ApiResult {
  status: number
  text: string
}

async function apiFetch(page: Page, path: string): Promise<ApiResult> {
  return page.evaluate(
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
}

async function ensureSubdomain(page: Page, subdomain: string): Promise<void> {
  const current = page.url()
  if (!current.includes(`${subdomain}.substack.com`)) {
    await page.goto(`https://${subdomain}.substack.com/`, { waitUntil: 'load', timeout: 30_000 })
    await new Promise(r => setTimeout(r, 2000))
  }
}

async function ensureSubstack(page: Page): Promise<void> {
  const host = new URL(page.url()).hostname
  if (host !== 'substack.com') {
    await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 30_000 })
    await new Promise(r => setTimeout(r, 2000))
  }
}

type Handler = (page: Page, params: Record<string, unknown>) => Promise<string>

const OPS: Record<string, Handler> = {
  async searchPosts(page, params) {
    await ensureSubstack(page)
    const query = encodeURIComponent(String(params.query ?? ''))
    const pg = Number(params.page ?? 0)
    return `/api/v1/post/search?query=${query}&page=${pg}`
  },
  async getArchive(page, params) {
    const sub = String(params.subdomain ?? '')
    await ensureSubdomain(page, sub)
    const sort = String(params.sort ?? 'new')
    const search = encodeURIComponent(String(params.search ?? ''))
    const offset = Number(params.offset ?? 0)
    const limit = Number(params.limit ?? 12)
    return `/api/v1/archive?sort=${sort}&search=${search}&offset=${offset}&limit=${limit}`
  },
  async getPost(page, params) {
    const sub = String(params.subdomain ?? '')
    const slug = String(params.slug ?? '')
    await ensureSubdomain(page, sub)
    return `/api/v1/posts/${encodeURIComponent(slug)}`
  },
  async getPostComments(page, params) {
    const sub = String(params.subdomain ?? '')
    const postId = String(params.postId ?? '')
    const allComments = params.all_comments !== false
    const sort = String(params.sort ?? 'best_first')
    await ensureSubdomain(page, sub)
    return `/api/v1/post/${postId}/comments?token=&all_comments=${String(allComments)}&sort=${sort}`
  },
}

const adapter: CustomRunner = {
  name: 'substack-api',
  description: 'Substack REST API — same-origin browser fetch to bypass DataDog RUM fetch wrapper on publication subdomains',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const { errors } = helpers
    const handler = OPS[operation]
    if (!handler) throw errors.unknownOp(operation)
    if (!page) throw errors.fatal('substack adapter requires a browser page')

    const path = await handler(page, { ...params })
    const resp = await apiFetch(page, path)
    if (resp.status >= 400) throw errors.httpError(resp.status)
    return JSON.parse(resp.text)
  },
}

export default adapter
