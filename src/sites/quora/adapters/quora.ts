import type { Page, Response as PwResponse } from 'patchright'

/**
 * Quora adapter — GraphQL interception + DOM extraction.
 *
 * Quora uses persisted GraphQL queries with page-scoped formkeys.
 * Direct replay fails (returns null data), so we navigate to the
 * correct pages and either intercept the GQL responses or extract
 * structured data from the DOM.
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

/** Intercept a GraphQL response matching the given operation name during navigation. */
async function interceptGql(
  page: Page,
  opName: string,
  navigateUrl: string,
  timeout = 15_000,
): Promise<unknown> {
  let captured: unknown = null
  const handler = async (resp: PwResponse) => {
    if (captured) return
    const url = resp.url()
    if (url.includes('graphql/gql') && url.includes(opName) && resp.status() < 400) {
      try {
        captured = await resp.json()
      } catch {
        /* ignore parse errors */
      }
    }
  }
  page.on('response', handler)

  try {
    await page.goto(navigateUrl, { waitUntil: 'load', timeout: 30_000 })
    const deadline = Date.now() + timeout
    while (!captured && Date.now() < deadline) {
      await wait(500)
    }
  } finally {
    page.off('response', handler)
  }

  return captured
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
  const result = (await interceptGql(page, 'SearchResultsListQuery', searchUrl)) as {
    data?: { searchConnection?: { edges?: unknown[]; pageInfo?: { hasNextPage: boolean } } }
  } | null

  const edges = result?.data?.searchConnection?.edges
  if (!edges || edges.length === 0) {
    throw errors.fatal('No search results — page may have failed to load')
  }

  const questions = (edges as { node: { question: Record<string, unknown> } }[])
    .slice(0, limit)
    .map((e) => {
      const q = e.node.question
      return {
        qid: q.qid,
        slug: (q.url as string)?.replace(/^\//, '') || '',
        title: parseTitle(String(q.title || '')),
        answerCount: q.decanonicalizedAnswerCount ?? 0,
        followerCount: q.followerCount ?? 0,
      }
    })

  return {
    questions,
    hasMore: result?.data?.searchConnection?.pageInfo?.hasNextPage ?? false,
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
