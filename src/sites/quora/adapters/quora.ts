import type { Page } from 'patchright'
import type { AdapterHelpers, CustomRunner } from '../../../types/adapter.js'

/**
 * Quora adapter — GraphQL intercept (Tier 4) for question/answer ops,
 * DOM extraction (Tier 2) for search and profile.
 *
 * Question/answer pages trigger QuestionPagedListPaginationQuery on load.
 * We intercept that GQL response for structured data (author, upvotes,
 * content, timestamps). For additional pages, we replay via pageFetch
 * (Tier 5) using the captured hash and formkey.
 *
 * Search: SSR-rendered HTML — no GQL query available.
 * Profile: No GQL profile query — DOM extraction only.
 */

const BASE = 'https://www.quora.com'
const GQL_ENDPOINT = `${BASE}/graphql/gql_para_POST`
const ANSWER_QUERY_NAME = 'QuestionPagedListPaginationQuery'

/* ---------- helpers ---------- */

/** Parse Quora's JSON-encoded rich text into plain text. */
function parseRichText(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    return (parsed.sections || [])
      .map((s: { spans: { text: string }[] }) =>
        (s.spans || []).map((sp) => sp.text).join(''),
      )
      .join('\n')
  } catch {
    return raw
  }
}

/** Extract formkey from page script tags. */
async function extractFormkey(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script')
    for (const s of scripts) {
      const text = s.textContent || ''
      const match = text.match(/formkey['":\s]*['"]([a-f0-9]{20,})['"]/)
      if (match) return match[1]
    }
    return null
  })
}

/** Parse multipart GQL response (--qgqlmpb boundary format). */
function parseMultipartGql(text: string): Record<string, unknown> | null {
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('{')) {
      try { return JSON.parse(trimmed) } catch {}
    }
  }
  try { return JSON.parse(text) } catch {}
  return null
}

/** Build Relay node ID: base64("Question@0:{qid}") */
function questionNodeId(qid: number): string {
  return btoa(`Question@0:${qid}`)
}

/** Extract author display name from GQL author object. */
function authorName(author: Record<string, unknown> | null): string {
  if (!author) return ''
  const names = author.names as { givenName?: string; familyName?: string }[] | undefined
  if (!names?.length) return ''
  const n = names[0]
  return [n.givenName, n.familyName].filter(Boolean).join(' ')
}

/** Format credential from GQL authorCredential. */
function formatCredential(cred: Record<string, unknown> | null): string {
  if (!cred) return ''
  if (cred.translatedString) return String(cred.translatedString)
  if (cred.description) return String(cred.description)
  return ''
}

/** Format large numbers (1200 → "1.2K"). */
function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

/* ---------- GQL intercept for question pages ---------- */

interface GqlCapture {
  hash: string
  variables: Record<string, unknown>
  data: Record<string, unknown> | null
}

/**
 * Navigate to a question page and intercept the QuestionPagedListPaginationQuery
 * GQL response. Returns the captured hash, variables, and parsed data.
 */
async function interceptQuestionGql(page: Page, slug: string): Promise<GqlCapture> {
  let capturedHash = ''
  let capturedVars: Record<string, unknown> = {}
  let capturedData: Record<string, unknown> | null = null

  const requestHandler = (req: { url: () => string; postData: () => string | null }) => {
    if (req.url().includes(ANSWER_QUERY_NAME)) {
      try {
        const body = JSON.parse(req.postData() || '{}')
        capturedHash = body.extensions?.hash || ''
        capturedVars = body.variables || {}
      } catch {}
    }
  }

  const responseHandler = async (resp: { url: () => string; text: () => Promise<string> }) => {
    if (resp.url().includes(ANSWER_QUERY_NAME) && !capturedData) {
      try {
        const text = await resp.text()
        const parsed = parseMultipartGql(text)
        if (parsed?.data) capturedData = parsed.data as Record<string, unknown>
      } catch {}
    }
  }

  page.on('request', requestHandler)
  page.on('response', responseHandler)

  try {
    await page.goto(`${BASE}/${slug}`, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
    // Wait for GQL response to arrive
    const deadline = Date.now() + 12_000
    while (!capturedData && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 300))
    }
  } finally {
    page.off('request', requestHandler)
    page.off('response', responseHandler)
  }

  return { hash: capturedHash, variables: capturedVars, data: capturedData }
}

/**
 * Fetch additional answer pages via pageFetch (Tier 5).
 */
async function fetchAnswerPage(
  page: Page,
  helpers: AdapterHelpers,
  formkey: string,
  hash: string,
  nodeId: string,
  cursor: string,
  count: number,
): Promise<Record<string, unknown> | null> {
  const result = await helpers.pageFetch(page, {
    url: `${GQL_ENDPOINT}?q=${ANSWER_QUERY_NAME}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'quora-formkey': formkey,
    },
    body: JSON.stringify({
      queryName: ANSWER_QUERY_NAME,
      variables: {
        count,
        cursor,
        forceScoreVersion: null,
        initial_count: count,
        topAid: null,
        id: nodeId,
      },
      extensions: { hash },
    }),
  })

  if (result.status >= 400) return null
  const parsed = parseMultipartGql(result.text)
  return (parsed?.data as Record<string, unknown>) || null
}

/* ---------- answer extraction from GQL data ---------- */

interface GqlAnswer {
  author: string
  authorUrl: string
  credential: string
  content: string
  upvotes: number
  views: number
  createdAt: string
  aid: number
}

function extractAnswersFromGql(data: Record<string, unknown>): {
  answers: GqlAnswer[]
  qid: number | null
  title: string
  hasMore: boolean
  endCursor: string
} {
  const node = data.node as Record<string, unknown> | undefined
  if (!node?.answers) return { answers: [], qid: null, title: '', hasMore: false, endCursor: '' }

  const answersConn = node.answers as {
    edges: { node: Record<string, unknown> }[]
    pageInfo?: { hasNextPage?: boolean; endCursor?: string }
  }

  let qid: number | null = null
  let title = ''
  const answers: GqlAnswer[] = []

  for (const edge of answersConn.edges || []) {
    const item = edge.node
    if (!item) continue

    const answer = item.answer as Record<string, unknown> | undefined
    if (!answer || answer.isDeleted) continue

    // Extract qid/title from first answer's question ref
    if (!qid && item.question) {
      const q = item.question as Record<string, unknown>
      qid = (q.qid as number) || null
      title = parseRichText(String(q.title || ''))
    }

    const author = answer.author as Record<string, unknown> | null
    const cred = answer.authorCredential as Record<string, unknown> | null

    answers.push({
      author: authorName(author),
      authorUrl: author?.profileUrl ? String(author.profileUrl) : '',
      credential: formatCredential(cred),
      content: parseRichText(String(answer.content || '')),
      upvotes: Number(answer.numUpvotes ?? 0),
      views: Number(answer.numViews ?? 0),
      createdAt: answer.creationTime
        ? new Date(Number(answer.creationTime) / 1000).toISOString()
        : '',
      aid: Number(answer.aid ?? 0),
    })
  }

  return {
    answers,
    qid,
    title,
    hasMore: answersConn.pageInfo?.hasNextPage ?? false,
    endCursor: answersConn.pageInfo?.endCursor ?? '',
  }
}

/* ---------- operations ---------- */

async function searchQuestions(
  page: Page,
  params: Record<string, unknown>,
  helpers: AdapterHelpers,
) {
  const { errors } = helpers
  const query = String(params.query || params.q || '')
  if (!query) throw errors.missingParam('query')
  const limit = Math.min(Number(params.limit ?? 10), 25)

  const searchUrl = `${BASE}/search?q=${encodeURIComponent(query)}&type=question`
  const context = page.context()
  const searchPage = await context.newPage()
  try {
    await searchPage.goto(searchUrl, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
    await new Promise(r => setTimeout(r, 5_000))

    const data = await searchPage.evaluate((max: number) => {
      const results: {
        qid: string | null
        slug: string
        title: string
        answerCount: number
        followerCount: number
      }[] = []
      const links = document.querySelectorAll('a[href]')
      const seen = new Set<string>()

      for (const link of links) {
        const href = link.getAttribute('href') || ''
        const match = href.match(/(?:https?:\/\/www\.quora\.com)?\/([A-Z][A-Za-z0-9-]+(?:-\d+)?)\/?$/)
        if (!match) continue
        const slug = match[1]
        if (seen.has(slug)) continue
        if (['search', 'profile', 'topic', 'about', 'contact', 'careers',
             'press', 'privacy', 'tos', 'settings'].includes(slug.toLowerCase())) continue
        const text = (link.textContent || '').trim()
        if (!text.endsWith('?') || text.length < 10) continue
        seen.add(slug)
        let answerCount = 0
        const container = link.closest('[class*="qu-"]') || link.parentElement?.parentElement
        if (container) {
          const containerText = container.textContent || ''
          const answerMatch = containerText.match(/(\d+)\s*answers?/i)
          if (answerMatch) answerCount = Number.parseInt(answerMatch[1], 10)
        }
        results.push({ qid: null, slug, title: text, answerCount, followerCount: 0 })
        if (results.length >= max) break
      }
      return results
    }, limit)

    if (data.length === 0) throw errors.fatal('No search results — page may have failed to load')
    return { questions: data, hasMore: data.length >= limit }
  } finally {
    await searchPage.close().catch(() => {})
  }
}

async function getQuestion(
  page: Page,
  params: Record<string, unknown>,
  helpers: AdapterHelpers,
) {
  const { errors } = helpers
  const slug = String(params.slug || '')
  if (!slug) throw errors.missingParam('slug')

  // Intercept GQL response during navigation
  const capture = await interceptQuestionGql(page, slug)

  // Extract question metadata from DOM (title, topics, follower count)
  const meta = await page.evaluate(() => {
    const title = document.title?.replace(/ - Quora$/, '').trim() || ''
    const bodyText = document.body.textContent || ''
    const answerMatch = bodyText.match(/([\d,]+)\s*answers?/i)
    const answerCount = answerMatch ? Number.parseInt(answerMatch[1].replace(/,/g, ''), 10) : 0
    const followerMatch = bodyText.match(/([\d,.]+[KMB]?)\s*followers?/i)
    const followerCount = followerMatch ? followerMatch[1] : '0'
    const topicEls = document.querySelectorAll('a[href*="/topic/"]')
    const topics: string[] = []
    for (const el of topicEls) {
      const text = el.textContent?.trim()
      if (text && !topics.includes(text) && text.length < 80) topics.push(text)
    }
    return { title, answerCount, followerCount, topics: topics.slice(0, 10) }
  })

  if (!meta.title) throw errors.fatal(`Question page did not load: ${slug}`)

  // Extract top answer previews from GQL data
  const topAnswers: {
    author: string
    credential: string
    content: string
    upvotes: string
  }[] = []

  if (capture.data) {
    const { answers } = extractAnswersFromGql(capture.data)
    for (const a of answers.slice(0, 3)) {
      topAnswers.push({
        author: a.author,
        credential: a.credential,
        content: a.content.substring(0, 500),
        upvotes: formatCount(a.upvotes),
      })
    }
  }

  // Fallback: DOM extraction for top answers if GQL intercept missed
  if (topAnswers.length === 0) {
    const domAnswers = await page.evaluate(() => {
      const upvoteBtns = document.querySelectorAll('button[aria-label*="Upvote"]')
      const results: { author: string; credential: string; content: string; upvotes: string }[] = []
      for (const btn of Array.from(upvoteBtns).slice(0, 3)) {
        let container = btn.parentElement
        for (let i = 0; i < 20; i++) {
          if (!container?.parentElement) break
          container = container.parentElement
          const text = container.textContent || ''
          if (text.length > 200) {
            const upvotes = btn.textContent?.replace('Upvote', '').replace('·', '').trim() || '0'
            const lines = text.split('\n').filter(l => l.trim())
            const authorMatch = lines[0]?.match(/^([^·]+)/)
            results.push({
              author: authorMatch?.[1]?.trim() || '',
              credential: '',
              content: text.substring(0, 500),
              upvotes,
            })
            break
          }
        }
      }
      return results
    })
    topAnswers.push(...domAnswers)
  }

  return { ...meta, topAnswers }
}

async function getAnswers(
  page: Page,
  params: Record<string, unknown>,
  helpers: AdapterHelpers,
) {
  const { errors } = helpers
  const slug = String(params.slug || '')
  if (!slug) throw errors.missingParam('slug')
  const limit = Math.min(Number(params.limit ?? 10), 20)

  // Intercept GQL response during navigation
  const capture = await interceptQuestionGql(page, slug)

  if (capture.data) {
    // Tier 4: Extract structured answers from GQL
    const { answers, qid, title, hasMore, endCursor } = extractAnswersFromGql(capture.data)

    // If we need more answers and have the hash, fetch additional pages (Tier 5)
    if (answers.length < limit && hasMore && capture.hash && qid) {
      const formkey = await extractFormkey(page)
      if (formkey) {
        const nodeId = questionNodeId(qid)
        const moreData = await fetchAnswerPage(
          page, helpers, formkey, capture.hash, nodeId, endCursor, limit - answers.length,
        )
        if (moreData) {
          const moreAnswers = extractAnswersFromGql(moreData)
          answers.push(...moreAnswers.answers)
        }
      }
    }

    return {
      slug,
      title,
      answers: answers.slice(0, limit).map(a => ({
        author: a.author,
        authorUrl: a.authorUrl,
        credential: a.credential,
        content: a.content,
        upvotes: formatCount(a.upvotes),
        views: formatCount(a.views),
        createdAt: a.createdAt,
      })),
    }
  }

  // Fallback: DOM extraction (Tier 2) when GQL pagination query doesn't fire
  const domData = await page.evaluate(
    (max: number) => {
      const answerContainers = document.querySelectorAll(
        '.q-box.spacing_log_answer_content',
      )
      const answers: { author: string; content: string; upvotes: string }[] = []

      for (const el of Array.from(answerContainers).slice(0, max)) {
        const content = el.textContent?.trim() || ''
        if (content.length < 20) continue
        const parent = el.closest('[class*="qu-pt--medium"]') || el.parentElement
        const btn = parent?.querySelector('button[aria-label*="Upvote"]')
        const upvotes = btn?.textContent?.replace('Upvote', '').replace('·', '').trim() || '0'
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

  if (domData.answers.length === 0) {
    throw errors.fatal(`No answers found on page: ${slug}`)
  }

  return {
    slug: domData.slug,
    title: '',
    answers: domData.answers.map(a => ({
      author: a.author,
      authorUrl: '',
      credential: '',
      content: a.content,
      upvotes: a.upvotes,
      views: '',
      createdAt: '',
    })),
  }
}

async function getProfile(
  page: Page,
  params: Record<string, unknown>,
  helpers: AdapterHelpers,
) {
  const { errors } = helpers
  const username = String(params.username || '')
  if (!username) throw errors.missingParam('username')

  // Open a fresh page to avoid ERR_BLOCKED_BY_RESPONSE on profile navigation
  const context = page.context()
  const profilePage = await context.newPage()
  try {
    await profilePage.goto(`${BASE}/profile/${username}`, { waitUntil: 'load', timeout: 30_000 })
    await profilePage.waitForTimeout(3_000)

    const data = await profilePage.evaluate(() => {
      const body = document.body.textContent || ''
      const title = document.title?.replace(/ - Quora$/, '').trim() || ''
      const followers = body.match(/([\d,.]+[KMB]?)\s*Followers?/i)
      const answers = body.match(/([\d,.]+[KMB]?)\s*Answers?/i)
      const questions = body.match(/([\d,.]+[KMB]?)\s*Questions?/i)
      const posts = body.match(/([\d,.]+[KMB]?)\s*Posts?/i)
      const bioEl = document.querySelector('.q-text.qu-wordBreak--break-word')
      const bio = bioEl?.textContent?.trim() || ''
      const profileImg = document.querySelector('img[src*="main-thumb"]') as HTMLImageElement | null
      const profileImageUrl = profileImg?.src || ''
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
  } finally {
    await profilePage.close().catch(() => {})
  }
}

/* ---------- adapter ---------- */

const OPERATIONS: Record<
  string,
  (page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) => Promise<unknown>
> = { searchQuestions, getQuestion, getAnswers, getProfile }

const adapter: CustomRunner = {
  name: 'quora',
  description: 'Quora — search questions, question detail, answers, user profiles',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page as Page, { ...params }, helpers)
  },
}

export default adapter
