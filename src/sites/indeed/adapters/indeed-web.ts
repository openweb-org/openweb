import type { Page, Response as PwResponse } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
/**
 * Indeed L3 adapter — page-based access to Indeed job search, salary, and company data.
 *
 * Indeed uses Cloudflare bot detection on all pages. Direct HTTP requests are blocked.
 * All operations use page navigation + data extraction from:
 * - window._initialData / mosaic.providerData (job search, job detail, company pages)
 * - __NEXT_DATA__ (salary pages — Next.js)
 * - application/ld+json (job detail — structured JobPosting schema)
 * - API interception (/cmp/_rpc/review-filter)
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import {
  SITE,
  browseJobCategories,
  extractNextData,
  getCompanyReviews,
  navigateAndWait,
} from './transforms.js'

/* ---------- operations ---------- */

async function searchJobs(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const q = String(params.q ?? '')
  const l = String(params.l ?? '')
  const start = Number(params.start ?? 0)
  if (!q) throw OpenWebError.missingParam('q')

  const url = new URL('/jobs', SITE)
  url.searchParams.set('q', q)
  if (l) url.searchParams.set('l', l)
  if (start > 0) url.searchParams.set('start', String(start))

  await navigateAndWait(page, url.toString())

  return page.evaluate(() => {
    const result: Record<string, unknown> = {}

    // Extract total count from _initialData
    const init = (window as any)._initialData
    if (init) {
      result.totalJobCount = init.totalJobCount
      result.uniqueJobsCount = init.uniqueJobsCount
      result.pageNum = init.pageNum
    }

    // Extract job cards from mosaic provider data
    const pd = (window as any).mosaic?.providerData?.['mosaic-provider-jobcards']
    const model = pd?.metaData?.mosaicProviderJobCardsModel
    if (model?.results) {
      result.jobs = model.results.map((r: any) => ({
        jobkey: r.jobkey,
        title: r.displayTitle || r.title,
        company: r.company || r.truncatedCompany,
        companyRating: r.companyRating,
        companyReviewCount: r.companyReviewCount,
        location: r.formattedLocation,
        remoteLocation: r.remoteLocation,
        salary: r.extractedSalary || r.salarySnippet,
        snippet: r.snippet,
        pubDate: r.pubDate,
        formattedRelativeTime: r.formattedRelativeTime,
        jobTypes: r.jobTypes,
        link: r.link,
        indeedApplyEnabled: r.indeedApplyEnabled,
        urgentlyHiring: r.urgentlyHiring,
        newJob: r.newJob,
      }))
    }

    return result
  })
}

async function getJobDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const jk = String(params.jk ?? '')
  if (!jk) throw OpenWebError.missingParam('jk')

  await navigateAndWait(page, `${SITE}/viewjob?jk=${encodeURIComponent(jk)}`)

  // Extract from LD+JSON (structured JobPosting) + _initialData
  return page.evaluate(() => {
    const result: Record<string, unknown> = {}

    // LD+JSON — most reliable structured data
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] === 'JobPosting') {
          result.title = data.title
          result.description = data.description
          result.datePosted = data.datePosted
          result.baseSalary = data.baseSalary
          result.employmentType = data.employmentType
          result.hiringOrganization = data.hiringOrganization
          result.jobLocation = data.jobLocation
          result.identifier = data.identifier
          result.directApply = data.directApply
        }
      } catch { /* skip */ }
    }

    // Supplement from _initialData
    const init = (window as any)._initialData
    if (init) {
      result.jobKey = init.jobKey
      if (!result.title) result.title = init.jobTitle
      result.jobLocation = result.jobLocation ?? init.jobLocation
      result.salaryInfoModel = init.salaryInfoModel
      result.benefitsModel = init.benefitsModel
      result.hiringInsightsModel = init.hiringInsightsModel
      result.companyInfo = init.companyTabModel
    }

    return result
  })
}

async function getSalary(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const title = String(params.title ?? '')
  if (!title) throw OpenWebError.missingParam('title')
  const location = params.location ? String(params.location) : null

  const slug = title.toLowerCase().replace(/\s+/g, '-')
  const url = location
    ? `${SITE}/career/${encodeURIComponent(slug)}/salaries/${encodeURIComponent(location)}`
    : `${SITE}/career/${encodeURIComponent(slug)}/salaries`

  await navigateAndWait(page, url)

  const nextData = await extractNextData(page)
  if (!nextData) return { error: 'No salary data found' }

  const props = (nextData as any).props?.pageProps
  if (!props) return { error: 'No pageProps found' }

  return {
    titleInfo: props.titleInfo,
    locationInfo: props.locationInfo,
    nationalSalaryAggregate: props.nationalSalaryAggregate,
    localSalaryAggregate: props.localSalaryAggregate,
    topPaidCities: props.topPaidCities,
    topPayingCompanies: props.topPayingCompanies,
    relatedTitlesResponse: props.relatedTitlesResponse,
    jobsCarouselData: props.jobsCarouselData,
  }
}

async function getCompanyOverview(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const company = String(params.company ?? '')
  if (!company) throw OpenWebError.missingParam('company')

  await navigateAndWait(page, `${SITE}/cmp/${encodeURIComponent(company)}`)

  return page.evaluate(() => {
    const result: Record<string, unknown> = {}
    const init = (window as any)._initialData
    if (init) {
      result.companyName = init.companyName
      result.about = init.aboutSectionViewModel
      result.ratings = init.reviewRatingOverallSectionViewModel
      result.salaries = init.salarySectionViewModel
      result.jobs = init.jobsSectionViewModel
      result.locations = init.locationsSectionViewModel
      result.interviews = init.interviewsSectionViewModel
      result.faq = init.faqSectionViewModel
      result.similarCompanies = init.similarCompaniesSectionViewModel
      result.header = init.companyPageHeader
    }

    // LD+JSON
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] === 'LocalBusiness') {
          result.ldJson = data
        }
      } catch { /* skip */ }
    }

    return result
  })
}

async function getCompanySalaries(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const company = String(params.company ?? '')
  if (!company) throw OpenWebError.missingParam('company')

  await navigateAndWait(page, `${SITE}/cmp/${encodeURIComponent(company)}/salaries`)

  return page.evaluate(() => {
    const result: Record<string, unknown> = {}

    // Extract salary table data from DOM
    const salaryRows = document.querySelectorAll('[data-testid="salary-table-row"], table tbody tr')
    const salaries: Record<string, unknown>[] = []
    for (const row of salaryRows) {
      const cells = row.querySelectorAll('td')
      if (cells.length >= 2) {
        salaries.push({
          jobTitle: cells[0]?.textContent?.trim(),
          salary: cells[1]?.textContent?.trim(),
          salaryCount: cells[2]?.textContent?.trim(),
        })
      }
    }
    if (salaries.length > 0) result.salaries = salaries

    // Try alternate DOM structure
    const salaryCards = document.querySelectorAll('[data-testid="salaryCard"], [class*="salaryRow"]')
    if (salaryCards.length > 0 && salaries.length === 0) {
      const cards: Record<string, unknown>[] = []
      for (const card of salaryCards) {
        cards.push({
          jobTitle: card.querySelector('[class*="jobTitle"], a')?.textContent?.trim(),
          salary: card.querySelector('[class*="salary"], [class*="amount"]')?.textContent?.trim(),
        })
      }
      result.salaries = cards
    }

    // Company name from header
    result.companyName = document.querySelector('h1, [data-testid="companyName"]')?.textContent?.trim()

    return result
  })
}

async function getReviewFilters(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const company = String(params.company ?? '')
  if (!company) throw OpenWebError.missingParam('company')

  // Navigate to reviews page and intercept the filter API
  const filterPromise = page.waitForResponse(
    (resp: PwResponse) => resp.url().includes('/cmp/_rpc/review-filter') && resp.status() === 200,
    { timeout: 15000 },
  )

  await page.goto(`${SITE}/cmp/${encodeURIComponent(company)}/reviews`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })

  const resp = await filterPromise
  return resp.json()
}

async function autocompleteJobTitle(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const q = String(params.q ?? '')
  if (!q) throw OpenWebError.missingParam('q')
  const country = String(params.country ?? 'US')

  return page.evaluate(
    async ({ query, ctry }) => {
      const url = `https://autocomplete.indeed.com/api/v0/suggestions/career-norm-job-title?query=${encodeURIComponent(query)}&country=${ctry}`
      const resp = await fetch(url)
      return resp.json()
    },
    { query: q, ctry: country },
  )
}

async function autocompleteLocation(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const q = String(params.q ?? '')
  if (!q) throw OpenWebError.missingParam('q')
  const country = String(params.country ?? 'US')

  return page.evaluate(
    async ({ query, ctry }) => {
      const url = `https://autocomplete.indeed.com/api/v0/suggestions/location?query=${encodeURIComponent(query)}&country=${ctry}`
      const resp = await fetch(url)
      return resp.json()
    },
    { query: q, ctry: country },
  )
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchJobs,
  getJobDetail,
  getSalary,
  getCompanyOverview,
  getCompanyReviews,
  getCompanySalaries,
  getReviewFilters,
  autocompleteJobTitle,
  autocompleteLocation,
  browseJobCategories,
}

const adapter: CodeAdapter = {
  name: 'indeed-web',
  description:
    'Indeed — job search, job details, salary data, company info, reviews via page navigation + data extraction',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('indeed.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://www.indeed.com')
    return cookies.some((c) => c.name === 'INDEED_CSRF_TOKEN')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw OpenWebError.unknownOp(operation)
      return await handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
