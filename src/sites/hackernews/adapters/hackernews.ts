import type { Page } from 'patchright'

const HN_ORIGIN = 'https://news.ycombinator.com'
const INDENT_UNIT = 40 // HN uses 40px per nesting level

async function extractFeed(page: Page, path: string): Promise<unknown> {
  await page.goto(`${HN_ORIGIN}${path}`, { waitUntil: 'domcontentloaded' })
  return page.evaluate(() => {
    const items = document.querySelectorAll('.athing')
    return Array.from(items).map((row) => {
      const subtext = row.nextElementSibling
      return {
        title: row.querySelector('.titleline > a')?.textContent ?? null,
        score: subtext?.querySelector('.score')?.textContent ?? null,
        author: subtext?.querySelector('.hnuser')?.textContent ?? null,
        age: subtext?.querySelector('.age a')?.textContent ?? null,
      }
    })
  })
}

async function extractJobFeed(page: Page): Promise<unknown> {
  await page.goto(`${HN_ORIGIN}/jobs`, { waitUntil: 'domcontentloaded' })
  return page.evaluate(() => {
    const items = document.querySelectorAll('.athing')
    return Array.from(items).map((row) => {
      const subtext = row.nextElementSibling
      return {
        title: row.querySelector('.titleline > a')?.textContent ?? null,
        age: subtext?.querySelector('.age a')?.textContent ?? null,
      }
    })
  })
}

async function getTopStories(page: Page, _params: Readonly<Record<string, unknown>>): Promise<unknown> {
  return extractFeed(page, '/news')
}

async function getNewestStories(page: Page, _params: Readonly<Record<string, unknown>>): Promise<unknown> {
  return extractFeed(page, '/newest')
}

async function getBestStories(page: Page, _params: Readonly<Record<string, unknown>>): Promise<unknown> {
  return extractFeed(page, '/best')
}

async function getAskStories(page: Page, _params: Readonly<Record<string, unknown>>): Promise<unknown> {
  return extractFeed(page, '/ask')
}

async function getShowStories(page: Page, _params: Readonly<Record<string, unknown>>): Promise<unknown> {
  return extractFeed(page, '/show')
}

async function getJobPostings(page: Page, _params: Readonly<Record<string, unknown>>): Promise<unknown> {
  return extractJobFeed(page)
}

async function getFrontPageStories(page: Page, _params: Readonly<Record<string, unknown>>): Promise<unknown> {
  return extractFeed(page, '/front')
}

async function getStoryDetail(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')

  await page.goto(`${HN_ORIGIN}/item?id=${id}`, { waitUntil: 'domcontentloaded' })

  return page.evaluate((indentUnit: number) => {
    const title = document.querySelector('.titleline > a')?.textContent ?? null
    const url = document.querySelector('.titleline > a')?.getAttribute('href') ?? null
    const site = document.querySelector('.sitestr')?.textContent ?? null
    const score = document.querySelector('.score')?.textContent ?? null
    const author = document.querySelector('.subline .hnuser')?.textContent ?? null
    const age = document.querySelector('.subline .age a')?.textContent ?? null

    const commentRows = document.querySelectorAll('.comtr')
    const comments = Array.from(commentRows).map((tr) => {
      const indentPx = Number(tr.querySelector('.ind img')?.getAttribute('width') ?? '0')
      return {
        id: tr.id,
        author: tr.querySelector('.hnuser')?.textContent ?? null,
        age: tr.querySelector('.age a')?.textContent ?? null,
        text: tr.querySelector('.commtext')?.textContent?.trim() ?? null,
        indent: Math.round(indentPx / indentUnit),
      }
    })

    return { title, url, site, score, author, age, commentCount: commentRows.length, comments }
  }, INDENT_UNIT)
}

async function getStoryComments(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')
  const limit = Number(params.limit ?? 50)

  await page.goto(`${HN_ORIGIN}/item?id=${id}`, { waitUntil: 'domcontentloaded' })

  return page.evaluate(({ indentUnit, maxComments }: { indentUnit: number; maxComments: number }) => {
    const commentRows = document.querySelectorAll('.comtr')
    const total = commentRows.length
    const comments = Array.from(commentRows).slice(0, maxComments).map((tr) => {
      const indentPx = Number(tr.querySelector('.ind img')?.getAttribute('width') ?? '0')
      return {
        id: tr.id,
        author: tr.querySelector('.hnuser')?.textContent ?? null,
        age: tr.querySelector('.age a')?.textContent ?? null,
        text: tr.querySelector('.commtext')?.textContent?.trim() ?? null,
        indent: Math.round(indentPx / indentUnit),
      }
    })

    return { storyId: Number(new URLSearchParams(window.location.search).get('id')), commentCount: total, comments }
  }, { indentUnit: INDENT_UNIT, maxComments: limit })
}

async function getUserProfile(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')

  await page.goto(`${HN_ORIGIN}/user?id=${id}`, { waitUntil: 'domcontentloaded' })

  return page.evaluate(() => {
    const rows = document.querySelectorAll('table table tr')
    const info: Record<string, string | null> = { user: null, created: null, karma: null, about: null }
    for (const row of rows) {
      const label = row.querySelector('td:first-child')?.textContent?.trim().replace(':', '').toLowerCase()
      const value = row.querySelector('td:last-child')?.textContent?.trim() ?? null
      if (label && label in info) {
        info[label] = value
      }
    }
    return info
  })
}

async function getNewComments(page: Page, _params: Readonly<Record<string, unknown>>): Promise<unknown> {
  await page.goto(`${HN_ORIGIN}/newcomments`, { waitUntil: 'domcontentloaded' })

  return page.evaluate(() => {
    const rows = document.querySelectorAll('.athing')
    return Array.from(rows).map((tr) => ({
      id: tr.id,
      author: tr.querySelector('.hnuser')?.textContent ?? null,
      age: tr.querySelector('.age a')?.textContent ?? null,
      text: tr.querySelector('.commtext')?.textContent?.trim() ?? null,
      indent: 0,
    }))
  })
}

async function getStoriesByDomain(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const site = params.site
  if (!site) throw new Error('site parameter is required')

  await page.goto(`${HN_ORIGIN}/from?site=${encodeURIComponent(String(site))}`, { waitUntil: 'domcontentloaded' })

  return page.evaluate(() => {
    const items = document.querySelectorAll('.athing')
    return Array.from(items).map((row) => {
      const subtext = row.nextElementSibling
      return {
        title: row.querySelector('.titleline > a')?.textContent ?? null,
        score: subtext?.querySelector('.score')?.textContent ?? null,
        author: subtext?.querySelector('.hnuser')?.textContent ?? null,
        age: subtext?.querySelector('.age a')?.textContent ?? null,
      }
    })
  })
}

async function getUserSubmissions(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')

  await page.goto(`${HN_ORIGIN}/submitted?id=${encodeURIComponent(String(id))}`, { waitUntil: 'domcontentloaded' })

  return page.evaluate(() => {
    const items = document.querySelectorAll('.athing')
    return Array.from(items).map((row) => {
      const subtext = row.nextElementSibling
      return {
        title: row.querySelector('.titleline > a')?.textContent ?? null,
        score: subtext?.querySelector('.score')?.textContent ?? null,
        author: subtext?.querySelector('.hnuser')?.textContent ?? null,
        age: subtext?.querySelector('.age a')?.textContent ?? null,
      }
    })
  })
}

async function upvoteStory(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')

  await page.goto(`${HN_ORIGIN}/item?id=${id}`, { waitUntil: 'domcontentloaded' })

  return page.evaluate((itemId: number) => {
    const voteLink = document.querySelector(`#up_${itemId}`) as HTMLAnchorElement | null
    if (!voteLink) throw new Error('Vote link not found — may require login or already voted')
    const href = voteLink.getAttribute('href')
    if (!href) throw new Error('Vote link has no href')

    return fetch(`https://news.ycombinator.com/${href}`, { credentials: 'include' })
      .then((res) => {
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

  return page.evaluate(async ({ parentId, commentText }: { parentId: number; commentText: string }) => {
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
  }, { parentId: Number(parent), commentText: String(text) })
}

async function getUserComments(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const id = params.id
  if (!id) throw new Error('id parameter is required')

  await page.goto(`${HN_ORIGIN}/threads?id=${encodeURIComponent(String(id))}`, { waitUntil: 'domcontentloaded' })

  return page.evaluate((indentUnit: number) => {
    const commentRows = document.querySelectorAll('.comtr')
    return Array.from(commentRows).map((tr) => {
      const indentPx = Number(tr.querySelector('.ind img')?.getAttribute('width') ?? '0')
      return {
        id: tr.id,
        author: tr.querySelector('.hnuser')?.textContent ?? null,
        age: tr.querySelector('.age a')?.textContent ?? null,
        text: tr.querySelector('.commtext')?.textContent?.trim() ?? null,
        indent: Math.round(indentPx / indentUnit),
      }
    })
  }, INDENT_UNIT)
}

const OPERATIONS: Record<string, (page: Page, params: Readonly<Record<string, unknown>>) => Promise<unknown>> = {
  getTopStories,
  getNewestStories,
  getBestStories,
  getAskStories,
  getShowStories,
  getJobPostings,
  getFrontPageStories,
  getStoryDetail,
  getStoryComments,
  getUserProfile,
  getNewComments,
  getStoriesByDomain,
  getUserSubmissions,
  getUserComments,
  upvoteStory,
  addComment,
}

const adapter = {
  name: 'hackernews',
  description: 'Hacker News DOM extraction — stories, comments, and user profiles',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('news.ycombinator.com') || url === 'about:blank'
  },

  async isAuthenticated(): Promise<boolean> {
    return true // HN public data requires no auth
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: { errors: { unknownOp(op: string): Error } }): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) {
      throw helpers.errors.unknownOp(operation)
    }
    return handler(page, params)
  },
}

export default adapter
