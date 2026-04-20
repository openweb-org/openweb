import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

const HN_ORIGIN = 'https://news.ycombinator.com'

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

async function unvoteStory(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')

  await page.goto(`${HN_ORIGIN}/item?id=${id}`, { waitUntil: 'domcontentloaded' })

  return page.evaluate((itemId: number) => {
    const link = document.querySelector(`#un_${itemId}`) as HTMLAnchorElement | null
    if (!link) throw new Error('Unvote link not found — item may not be upvoted')
    const href = link.getAttribute('href')
    if (!href) throw new Error('Unvote link has no href')

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
      const userLink = document.querySelector('#me') as HTMLAnchorElement | null
      const username = userLink?.textContent?.trim()
      if (!username) throw new Error('Logged-in username not found (#me)')

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

      const threadsRes = await fetch(`https://news.ycombinator.com/threads?id=${username}`, {
        credentials: 'include',
      })
      const threadsHtml = await threadsRes.text()
      const m = threadsHtml.match(/<tr class="athing comtr" id="(\d+)"/)
      if (!m) throw new Error('Could not locate newly posted comment id')
      return { ok: true, parent: parentId, id: Number(m[1]) }
    },
    { parentId: Number(parent), commentText: String(text) },
  )
}

async function deleteComment(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')

  await page.goto(`${HN_ORIGIN}/news`, { waitUntil: 'domcontentloaded' })

  return page.evaluate(async (commentId: number) => {
    const goto = `item?id=${commentId}`
    const confirmRes = await fetch(
      `https://news.ycombinator.com/delete-confirm?id=${commentId}&goto=${encodeURIComponent(goto)}`,
      { credentials: 'include' },
    )
    if (!confirmRes.ok) throw new Error(`delete-confirm HTTP ${confirmRes.status}`)
    const html = await confirmRes.text()
    const hmacM = html.match(/name="hmac"\s+value="([^"]+)"/)
    if (!hmacM) throw new Error('HMAC not found in delete-confirm form (delete window may have expired)')

    const body = new URLSearchParams({
      id: String(commentId),
      goto,
      hmac: hmacM[1],
      d: 'Yes',
    })
    const res = await fetch('https://news.ycombinator.com/xdelete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'include',
      body: body.toString(),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return { ok: true, id: commentId }
  }, Number(id))
}

const OPERATIONS: Record<
  string,
  (page: Page, params: Readonly<Record<string, unknown>>) => Promise<unknown>
> = {
  upvoteStory,
  unvoteStory,
  addComment,
  deleteComment,
}

const adapter: CustomRunner = {
  name: 'hackernews',
  description: 'Hacker News — Algolia API for parameterized reads (node), page context for writes',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    if (!page) throw new Error(`Operation ${operation} requires a page context`)
    return handler(page, params)
  },
}

export default adapter
