import type { Page } from 'patchright'

const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1'
const HN_ORIGIN = 'https://news.ycombinator.com'

// ── Adapter read ops: Node.js fetch to Algolia (zero DOM) ───────────

async function getStoryComments(_page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')
  const limit = Number(params.limit ?? 50)

  const url = `${ALGOLIA_BASE}/search_by_date?tags=comment&numericFilters=${encodeURIComponent(`story_id=${id}`)}&hitsPerPage=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Algolia HTTP ${res.status}`)
  const data = (await res.json()) as { nbHits: number; hits: unknown[] }
  return { storyId: Number(id), commentCount: data.nbHits, comments: data.hits }
}

async function getStoriesByDomain(_page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const site = params.site
  if (!site) throw new Error('site parameter is required')

  const url = `${ALGOLIA_BASE}/search?tags=story&query=${encodeURIComponent(String(site))}&restrictSearchableAttributes=url&hitsPerPage=30`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Algolia HTTP ${res.status}`)
  const data = (await res.json()) as { hits: unknown[] }
  return data.hits
}

async function getUserSubmissions(_page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')

  const url = `${ALGOLIA_BASE}/search_by_date?tags=${encodeURIComponent(`story,author_${id}`)}&hitsPerPage=30`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Algolia HTTP ${res.status}`)
  const data = (await res.json()) as { hits: unknown[] }
  return data.hits
}

async function getUserComments(_page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')

  const url = `${ALGOLIA_BASE}/search_by_date?tags=${encodeURIComponent(`comment,author_${id}`)}&hitsPerPage=30`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Algolia HTTP ${res.status}`)
  const data = (await res.json()) as { hits: unknown[] }
  return data.hits
}

// ── Write ops: browser page context for auth token extraction ───────

async function upvoteStory(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')

  await page.goto(`${HN_ORIGIN}/item?id=${id}`, { waitUntil: 'domcontentloaded' })

  return page.evaluate((itemId: number) => {
    const voteLink = document.querySelector(`#up_${itemId}`) as HTMLAnchorElement | null
    if (!voteLink) throw new Error('Vote link not found — may require login or already voted')
    const href = voteLink.getAttribute('href')
    if (!href) throw new Error('Vote link has no href')

    return fetch(`https://news.ycombinator.com/${href}`, { credentials: 'include' }).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { ok: true, id: itemId }
    })
  }, Number(id))
}

async function addComment(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const parent = params.parent
  const text = params.text
  if (!parent) throw new Error('parent parameter is required')
  if (!text) throw new Error('text parameter is required')

  await page.goto(`${HN_ORIGIN}/item?id=${parent}`, { waitUntil: 'domcontentloaded' })

  return page.evaluate(
    async ({ parentId, commentText }: { parentId: number; commentText: string }) => {
      const form = document.querySelector('form[action="comment"]') as HTMLFormElement | null
      if (!form) throw new Error('Comment form not found — may require login')
      const hmacInput = form.querySelector('input[name="hmac"]') as HTMLInputElement | null
      if (!hmacInput) throw new Error('HMAC token not found in comment form')

      const body = new URLSearchParams({
        parent: String(parentId),
        text: commentText,
        hmac: hmacInput.value,
        goto: `item?id=${parentId}`,
      })

      const res = await fetch('https://news.ycombinator.com/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'include',
        body: body.toString(),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { ok: true, parent: parentId }
    },
    { parentId: Number(parent), commentText: String(text) },
  )
}

// ── Adapter registration ────────────────────────────────────────────

const OPERATIONS: Record<
  string,
  (page: Page, params: Readonly<Record<string, unknown>>) => Promise<unknown>
> = {
  getStoryComments,
  getStoriesByDomain,
  getUserSubmissions,
  getUserComments,
  upvoteStory,
  addComment,
}

const adapter = {
  name: 'hackernews',
  description: 'Hacker News — Algolia API for parameterized reads, page context for writes',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('news.ycombinator.com') || url === 'about:blank'
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: { errors: { unknownOp(op: string): Error } },
  ): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params)
  },
}

export default adapter
