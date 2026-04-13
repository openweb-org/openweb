import type { Page } from 'patchright'

/**
 * Quora adapter — DOM extraction for all operations.
 *
 * Quora now SSR-renders search results (no separate GraphQL query for search).
 * All operations navigate to the correct page and extract structured data
 * from the DOM.
 */

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BASE = 'https://www.quora.com'

/** Parse Quora's JSON-encoded rich text title into plain text. */
function parseTitle(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    return (parsed.sections || [])
      .map((s: { spans: { text: string }[] }) =>
        (s.spans || []).map((sp) => sp.text).join(''),
      )
      .join('')
  } catch {
    return raw
  }
}

async function searchQuestions(
  page: Page,
  params: Record<string, unknown>,
  errors: Errors,
) {
  const query = String(params.query || params.q || '')
  if (!query) throw errors.missingParam('query')
  const limit = Math.min(Number(params.limit ?? 10), 25)

  const searchUrl = `${BASE}/search?q=${encodeURIComponent(query)}&type=question`
  // Create a fresh page for search — the warm-up page may have stale state
  const context = page.context()
  const searchPage = await context.newPage()
  try {
    await searchPage.goto(searchUrl, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
    await wait(5_000)

    // Extract search results from DOM — Quora now SSR-renders search results
    const data = await searchPage.evaluate((max: number) => {
      const results: {
        qid: string | null
        slug: string
        title: string
        answerCount: number
        followerCount: number
      }[] = []

      // Find question links — they end with "?" and link to quora.com question pages
      const links = document.querySelectorAll('a[href]')
      const seen = new Set<string>()

      for (const link of links) {
        const href = link.getAttribute('href') || ''
        // Question URLs: https://www.quora.com/Question-Slug-Here or /Question-Slug-Here
        const match = href.match(/(?:https?:\/\/www\.quora\.com)?\/([A-Z][A-Za-z0-9-]+(?:-\d+)?)\/?$/)
        if (!match) continue

        const slug = match[1]
        if (seen.has(slug)) continue
        // Skip non-question paths
        if (['search', 'profile', 'topic', 'about', 'contact', 'careers',
             'press', 'privacy', 'tos', 'settings'].includes(slug.toLowerCase())) continue

        // Get the text — question titles end with "?"
        const text = (link.textContent || '').trim()
        if (!text.endsWith('?') || text.length < 10) continue

        seen.add(slug)

        // Try to find answer count near the link
        let answerCount = 0
        const container = link.closest('[class*="qu-"]') || link.parentElement?.parentElement
        if (container) {
          const containerText = container.textContent || ''
          const answerMatch = containerText.match(/(\d+)\s*answers?/i)
          if (answerMatch) answerCount = parseInt(answerMatch[1], 10)
        }

        results.push({
          qid: null,
          slug,
          title: text,
          answerCount,
          followerCount: 0,
        })

        if (results.length >= max) break
      }

      return results
    }, limit)

    if (data.length === 0) {
      throw errors.fatal('No search results — page may have failed to load')
    }

    return {
      questions: data,
      hasMore: data.length >= limit,
    }
  } finally {
    await searchPage.close().catch(() => {})
  }
}

async function getQuestion(
  page: Page,
  params: Record<string, unknown>,
  errors: Errors,
) {
  const slug = String(params.slug || '')
  if (!slug) throw errors.missingParam('slug')

  await page.goto(`${BASE}/${slug}`, {
    waitUntil: 'load',
    timeout: 30_000,
  })
  await page.waitForTimeout(3_000)

  const data = await page.evaluate(() => {
    const title = document.title?.replace(/ - Quora$/, '').trim() || ''

    // Extract answer count from page text
    const bodyText = document.body.textContent || ''
    const answerMatch = bodyText.match(/([\d,]+)\s*answers?/i)
    const answerCount = answerMatch
      ? Number.parseInt(answerMatch[1].replace(/,/g, ''), 10)
      : 0

    // Extract follower count
    const followerMatch = bodyText.match(/([\d,.]+[KMB]?)\s*followers?/i)
    const followerCount = followerMatch ? followerMatch[1] : '0'

    // Get topics from topic links
    const topicEls = document.querySelectorAll('a[href*="/topic/"]')
    const topics: string[] = []
    for (const el of topicEls) {
      const text = el.textContent?.trim()
      if (text && !topics.includes(text) && text.length < 80) topics.push(text)
    }

    // Get first few answers from the page
    const upvoteBtns = document.querySelectorAll('button[aria-label*="Upvote"]')
    const topAnswers: {
      author: string
      credential: string
      content: string
      upvotes: string
    }[] = []

    for (const btn of Array.from(upvoteBtns).slice(0, 3)) {
      let container = btn.parentElement
      for (let i = 0; i < 20; i++) {
        if (!container?.parentElement) break
        container = container.parentElement
        const text = container.textContent || ''
        if (text.length > 200) {
          const upvotes = btn.textContent?.replace('Upvote', '').replace('·', '').trim() || '0'
          // First line often has: AuthorName · Follow Credential · TimeAgo
          const lines = text.split('\n').filter((l) => l.trim())
          const authorLine = lines[0] || ''
          const authorMatch = authorLine.match(/^([^·]+)/)
          const credMatch = authorLine.match(/(?:Follow\s+)?([^·]+)·\s*\d/)

          topAnswers.push({
            author: authorMatch?.[1]?.trim() || '',
            credential: credMatch?.[1]?.trim() || '',
            content: text.substring(0, 500),
            upvotes,
          })
          break
        }
      }
    }

    return { title, answerCount, followerCount, topics: topics.slice(0, 10), topAnswers }
  })

  if (!data.title) throw errors.fatal(`Question page did not load: ${slug}`)
  return data
}

async function getAnswers(
  page: Page,
  params: Record<string, unknown>,
  errors: Errors,
) {
  const slug = String(params.slug || '')
  if (!slug) throw errors.missingParam('slug')
  const limit = Math.min(Number(params.limit ?? 10), 20)

  await page.goto(`${BASE}/${slug}`, {
    waitUntil: 'load',
    timeout: 30_000,
  })
  await page.waitForTimeout(3_000)

  const data = await page.evaluate(
    (max: number) => {
      const answerContainers = document.querySelectorAll(
        '.q-box.spacing_log_answer_content',
      )

      const answers: {
        author: string
        content: string
        upvotes: string
      }[] = []

      for (const el of Array.from(answerContainers).slice(0, max)) {
        const content = el.textContent?.trim() || ''
        if (content.length < 20) continue

        // Find associated upvote button
        const parent = el.closest('[class*="qu-pt--medium"]') || el.parentElement
        const btn = parent?.querySelector('button[aria-label*="Upvote"]')
        const upvotes = btn?.textContent?.replace('Upvote', '').replace('·', '').trim() || '0'

        // Find author — look in siblings or parent elements
        const wrapper = el.parentElement?.parentElement
        const allText = wrapper?.textContent || ''
        const authorMatch = allText.match(/^([A-Z][^·\n]{1,40})·/)

        answers.push({
          author: authorMatch?.[1]?.trim() || '',
          content,
          upvotes,
        })
      }

      return { slug: window.location.pathname.replace(/^\//, ''), answers }
    },
    limit,
  )

  if (data.answers.length === 0) {
    throw errors.fatal(`No answers found on page: ${slug}`)
  }

  return data
}

async function getProfile(
  page: Page,
  params: Record<string, unknown>,
  errors: Errors,
) {
  const username = String(params.username || '')
  if (!username) throw errors.missingParam('username')

  await page.goto(`${BASE}/profile/${username}`, {
    waitUntil: 'load',
    timeout: 30_000,
  })
  await page.waitForTimeout(3_000)

  const data = await page.evaluate(() => {
    const body = document.body.textContent || ''
    const title = document.title?.replace(/ - Quora$/, '').trim() || ''

    // Parse stats from page text
    const followers = body.match(/([\d,.]+[KMB]?)\s*Followers?/i)
    const answers = body.match(/([\d,.]+[KMB]?)\s*Answers?/i)
    const questions = body.match(/([\d,.]+[KMB]?)\s*Questions?/i)
    const posts = body.match(/([\d,.]+[KMB]?)\s*Posts?/i)

    // Bio — typically a short text in the profile area
    const bioEl = document.querySelector('.q-text.qu-wordBreak--break-word')
    const bio = bioEl?.textContent?.trim() || ''

    // Profile image
    const profileImg = document.querySelector('img[src*="main-thumb"]') as HTMLImageElement | null
    const profileImageUrl = profileImg?.src || ''

    // Expertise topics
    const topicLinks = document.querySelectorAll('a[href*="/topic/"]')
    const topics: string[] = []
    for (const el of topicLinks) {
      const text = el.textContent?.trim()
      if (text && !topics.includes(text) && text.length < 80) topics.push(text)
    }

    return {
      name: title,
      bio,
      profileImageUrl,
      followers: followers?.[1] || '0',
      answers: answers?.[1] || '0',
      questions: questions?.[1] || '0',
      posts: posts?.[1] || '0',
      knownFor: topics.slice(0, 10),
    }
  })

  if (!data.name) throw errors.fatal(`Profile not found: ${username}`)
  return data
}

const OPERATIONS: Record<
  string,
  (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>
> = {
  searchQuestions,
  getQuestion,
  getAnswers,
  getProfile,
}

const adapter = {
  name: 'quora',
  description: 'Quora — search questions, question detail, answers, user profiles',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('quora.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // Public read access
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: { errors: Errors },
  ): Promise<unknown> {
    const { errors } = helpers
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page, { ...params }, errors)
  },
}

export default adapter
