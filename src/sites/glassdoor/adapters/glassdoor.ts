import type { Page } from 'patchright'

import type { AdapterHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

const GD_ORIGIN = 'https://www.glassdoor.com'
const GRAPHQL_URL = `${GD_ORIGIN}/graph`
const CF_POLL_MS = 2_000
const CF_MAX_WAIT_MS = 30_000

type Errors = AdapterHelpers['errors']

async function isCloudflareBlocked(page: Page): Promise<boolean> {
  try {
    const title = await page.title()
    return title.includes('moment') || title.includes('Checking')
  } catch {
    return false
  }
}

async function waitForCloudflare(page: Page, errors: Errors): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < CF_MAX_WAIT_MS) {
    if (!(await isCloudflareBlocked(page))) return
    await page.waitForTimeout(CF_POLL_MS)
  }
  throw errors.botBlocked('Cloudflare challenge not resolved. Run `openweb browser restart --no-headless`, solve CAPTCHA if visible, then retry.')
}

async function navigateTo(page: Page, url: string, errors: Errors): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await waitForCloudflare(page, errors)
  await page.waitForTimeout(2_000)
}

/* ---------- GraphQL helper ---------- */

const REVIEW_QUERY = `
  query EmployerReview($reviewId: Int!, $language: String) {
    employerReview: employerReviewRG(
      employerReviewInput: { reviewIdent: { id: $reviewId }, language: $language }
    ) {
      reviews {
        reviewId
        reviewDateTime
        ratingOverall
        summary
        pros
        cons
        jobTitle { text }
        employer { id shortName }
      }
    }
  }
`

async function graphqlFetch(
  page: Page,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data?: unknown; errors?: Array<{ message: string }> }> {
  const result = await page.evaluate(
    async (args: { url: string; body: string }) => {
      const resp = await fetch(args.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'gd-csrf-token': '1' },
        body: args.body,
        credentials: 'include',
      })
      return { status: resp.status, text: await resp.text() }
    },
    { url: GRAPHQL_URL, body: JSON.stringify({ query, variables }) },
  )
  if (result.status >= 400) {
    throw new Error(`GraphQL request failed with status ${result.status}`)
  }
  return JSON.parse(result.text)
}

/* ---------- searchCompanies (Tier 3 — SSR/NEXT_DATA) ---------- */

async function searchCompanies(page: Page, params: Readonly<Record<string, unknown>>, errors: Errors): Promise<unknown> {
  const query = String(params.query ?? '')
  if (!query) throw errors.missingParam('query')

  await navigateTo(page, `${GD_ORIGIN}/Reviews/company-reviews.htm?sc.keyword=${encodeURIComponent(query)}`, errors)

  return page.evaluate(() => {
    const el = document.querySelector('#__NEXT_DATA__')
    if (!el) return { count: 0, companies: [] }
    try {
      const data = JSON.parse(el.textContent ?? '')
      const cache = data.props?.pageProps?.apolloCache
      if (!cache) return { count: 0, companies: [] }

      const companies: Array<Record<string, unknown>> = []

      for (const [key, val] of Object.entries(cache)) {
        if (!key.startsWith('Employer:')) continue
        const emp = val as Record<string, unknown>
        if (!emp.shortName || !emp.ratings) continue
        const ratings = emp.ratings as Record<string, unknown>
        const industry = emp.primaryIndustry as Record<string, unknown> | null
        companies.push({
          employerId: emp.id as number,
          name: emp.shortName as string,
          overallRating: (ratings.overallRating as number) ?? null,
          headquarters: (emp.headquarters as string) ?? null,
          industry: (industry?.industryName as string) ?? null,
          sizeCategory: (emp.sizeCategory as string) ?? null,
          logo: (emp.squareLogoUrl as string) ?? null,
        })
      }
      return { count: companies.length, companies }
    } catch {
      return { count: 0, companies: [] }
    }
  })
}

/* ---------- getReviews (Tier 5 — page navigate + GraphQL fetch) ---------- */

async function getReviews(page: Page, params: Readonly<Record<string, unknown>>, errors: Errors): Promise<unknown> {
  const employerId = params.employerId
  if (!employerId) throw errors.missingParam('employerId')

  await navigateTo(page, `${GD_ORIGIN}/Reviews/Company-Reviews-E${employerId}.htm`, errors)
  await page.waitForSelector('article[data-test="review-detail"]', { timeout: 10_000 }).catch(() => {})

  // Extract review IDs from data-brandviews attributes
  const reviewIds: number[] = await page.evaluate(() => {
    const articles = document.querySelectorAll('article[data-test="review-detail"]')
    const ids: number[] = []
    for (const article of articles) {
      const bv = article.getAttribute('data-brandviews') ?? ''
      const match = bv.match(/review_id=(\d+)/)
      if (match) ids.push(Number.parseInt(match[1]))
    }
    return ids
  })

  // Extract company name and overall rating from JSON-LD (most reliable) or page header
  const pageInfo = await page.evaluate(() => {
    let companyName: string | null = null
    let overallRating: string | null = null

    // Try JSON-LD first — has structured rating data
    const jsonLd = document.querySelectorAll('script[type="application/ld+json"]')
    for (const el of jsonLd) {
      try {
        const data = JSON.parse(el.textContent ?? '')
        if (data['@type'] === 'EmployerAggregateRating') {
          companyName = data.itemReviewed?.name ?? null
          overallRating = data.ratingValue ?? null
          break
        }
      } catch { /* skip */ }
    }

    // Fall back to H1 for company name
    if (!companyName) {
      const h1 = document.querySelector('h1')
      companyName = h1?.textContent?.trim()?.replace(/\s*reviews$/i, '') ?? null
    }

    return { companyName, overallRating }
  })

  if (reviewIds.length === 0) {
    return { ...pageInfo, reviews: [] }
  }

  // Fetch each review via GraphQL — deduplicate results
  const seen = new Set<number>()
  const reviews: Array<Record<string, unknown>> = []

  for (const reviewId of reviewIds) {
    try {
      const resp = await graphqlFetch(page, REVIEW_QUERY, { reviewId })
      const data = resp.data as { employerReview?: { reviews?: Array<Record<string, unknown>> } } | undefined
      const items = data?.employerReview?.reviews ?? []

      for (const item of items) {
        const rid = item.reviewId as number
        if (seen.has(rid)) continue
        seen.add(rid)

        const dateStr = item.reviewDateTime as string | null
        let formattedDate: string | null = null
        if (dateStr) {
          try {
            formattedDate = new Date(dateStr).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
            })
          } catch { formattedDate = dateStr }
        }

        reviews.push({
          rating: item.ratingOverall != null ? String(item.ratingOverall) : null,
          date: formattedDate,
          title: (item.summary as string) ?? null,
          jobTitle: ((item.jobTitle as Record<string, unknown>)?.text as string) ?? null,
          employeeStatus: null,
          pros: (item.pros as string) ?? null,
          cons: (item.cons as string) ?? null,
        })
      }
    } catch {
      // Skip failed individual review fetches
    }
  }

  return { ...pageInfo, reviews }
}

/* ---------- getSalaries (Tier 2 — DOM extraction, no GraphQL available) ---------- */

async function getSalaries(page: Page, params: Readonly<Record<string, unknown>>, errors: Errors): Promise<unknown> {
  const employerId = params.employerId
  if (!employerId) throw errors.missingParam('employerId')

  await navigateTo(page, `${GD_ORIGIN}/Salary/Company-Salaries-E${employerId}.htm`, errors)
  await page.waitForSelector('a[href*="/Salary/"]', { timeout: 10_000 }).catch(() => {})

  return page.evaluate(() => {
    const h1 = document.querySelector('h1')
    const titleText = h1?.textContent?.trim() ?? ''

    const companyName = titleText.replace(/\s*salaries$/i, '').replace(/^how much does\s*/i, '').replace(/\s*pay.*$/i, '') || null
    const countMatch = document.title.match(/\(([\d,]+)\s+Salaries?\)/i)
    const totalSalaries = countMatch ? countMatch[1] : null

    const salaryLinks = document.querySelectorAll('a[href*="/Salary/"][href*="_D_KO"]')
    const salaries: Array<{ jobTitle: string; salaryCount: string | null; payRange: string | null }> = []

    for (const link of salaryLinks) {
      const jobTitle = link.textContent?.trim()
      if (!jobTitle || jobTitle.length < 2) continue

      const parent = link.closest('div')?.parentElement ?? link.parentElement
      const parentText = parent?.innerText ?? ''

      const countMatch = parentText.match(/([\d,]+)\s+Salaries?\s+submitted/i)
      const rangeMatch = parentText.match(/(\$[\d,]+K?\s*-\s*\$[\d,]+K?\s*\/\w+)/i)

      salaries.push({
        jobTitle,
        salaryCount: countMatch ? countMatch[1] : null,
        payRange: rangeMatch ? rangeMatch[1] : null,
      })
    }
    return { companyName, totalSalaries, salaries }
  })
}

/* ---------- getInterviews (Tier 4+5 — intercept GraphQL + DOM metadata) ---------- */

async function getInterviews(page: Page, params: Readonly<Record<string, unknown>>, errors: Errors): Promise<unknown> {
  const employerId = params.employerId
  if (!employerId) throw errors.missingParam('employerId')

  // Intercept GraphQL responses during page navigation
  const graphqlInterviews: Array<{ id: number; description: string | null; role: string | null }> = []

  const responseHandler = async (resp: { url(): string; request(): { postData(): string | null }; text(): Promise<string> }) => {
    if (!resp.url().includes('/graph')) return
    try {
      const postData = resp.request().postData() ?? ''
      if (!postData.includes('EmployerInterviewInfoIG')) return
      const body = JSON.parse(await resp.text())
      const info = body?.data?.employerInterviewInfoIG
      if (info) {
        graphqlInterviews.push({
          id: info.id,
          description: info.processDescription ?? null,
          role: info.jobTitle?.text ?? null,
        })
      }
    } catch { /* skip unparseable */ }
  }

  page.on('response', responseHandler)
  await page.goto(`${GD_ORIGIN}/Interview/Company-Interview-Questions-E${employerId}.htm`, {
    waitUntil: 'domcontentloaded', timeout: 30_000,
  })
  await waitForCloudflare(page, errors)
  await page.waitForTimeout(5_000) // Allow GraphQL requests to complete
  page.removeListener('response', responseHandler)

  // Extract page-level metadata and per-card DOM data
  const pageData = await page.evaluate(() => {
    const h1 = document.querySelector('h1')
    const companyName = h1?.textContent?.trim()?.replace(/\s*interview questions$/i, '') ?? null

    const diffEl = document.querySelector('[data-test="interview-difficulty-score"]')
    const difficulty = diffEl?.textContent?.replace(/^Difficulty\s*/i, '')?.trim()?.split('\n')[0] ?? null

    const countMatch = document.body.innerText.match(/([\d,]+)\s+interviews?/i)
    const interviewCount = countMatch ? countMatch[1] : null

    const cards = document.querySelectorAll('div[id^="interviews-"]')
    const cardMeta: Array<Record<string, string | null>> = []

    for (const card of cards) {
      const text = card.innerText ?? ''
      const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean)

      let date: string | null = null
      let location: string | null = null
      let offerStatus: string | null = null
      let experience: string | null = null
      let cardDifficulty: string | null = null
      let role: string | null = null

      for (const line of lines) {
        if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}$/i.test(line)) date = line
        if (/Declined offer|Accepted offer|No offer/.test(line)) offerStatus = line
        if (/Positive|Negative|Neutral/.test(line) && line.includes('xperience')) {
          experience = line.replace(/experience/i, '').trim()
        }
        if ((line.includes('Easy') || line.includes('Average') || line.includes('Difficult')) && line.includes('nterview')) {
          cardDifficulty = line.replace(/interview/i, '').trim()
        }
        if (/^[A-Z][\w\s]+,\s*[A-Z]{2}$/.test(line) || /^[A-Z][\w\s]+,\s*[A-Z][\w\s]+$/.test(line)) {
          location = line
        }
      }

      const roleMatch = lines[0]?.match(/^(.+?)\s*Interview$/)
      if (roleMatch) role = roleMatch[1]

      cardMeta.push({ role, date, location, offerStatus, experience, difficulty: cardDifficulty })
    }

    return { companyName, difficulty, interviewCount, cardMeta }
  })

  // Merge: GraphQL data (description + role) with DOM card metadata (date, difficulty, etc.)
  // Both are rendered in the same order on the page
  const interviews: Array<Record<string, string | null>> = []
  const cardCount = Math.max(graphqlInterviews.length, pageData.cardMeta.length)

  for (let i = 0; i < cardCount; i++) {
    const gql = graphqlInterviews[i]
    const dom = pageData.cardMeta[i]
    if (!gql && !dom) continue

    interviews.push({
      role: gql?.role ?? dom?.role ?? null,
      date: dom?.date ?? null,
      location: dom?.location ?? null,
      offerStatus: dom?.offerStatus ?? null,
      experience: dom?.experience ?? null,
      difficulty: dom?.difficulty ?? null,
      description: gql?.description ?? null,
    })
  }

  return {
    companyName: pageData.companyName,
    difficulty: pageData.difficulty,
    interviewCount: pageData.interviewCount,
    interviews,
  }
}

/* ---------- runner export ---------- */

type Handler = (page: Page, params: Readonly<Record<string, unknown>>, errors: Errors) => Promise<unknown>

const OPERATIONS: Record<string, Handler> = {
  searchCompanies,
  getReviews,
  getSalaries,
  getInterviews,
}

const runner: CustomRunner = {
  name: 'glassdoor',
  description: 'Glassdoor — company reviews, salaries, interviews via GraphQL + SSR + DOM extraction',

  async run(ctx: PreparedContext): Promise<unknown> {
    const { page, operation, params, helpers } = ctx
    const { errors } = helpers
    if (!page) throw errors.fatal('glassdoor requires a page (transport: page)')
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    if (await isCloudflareBlocked(page)) {
      await waitForCloudflare(page, errors)
    }
    return handler(page, params, errors)
  },
}

export default runner
