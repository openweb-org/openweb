import type { Page } from 'playwright-core'

// Self-contained types — avoid external imports so adapter works from compile cache
interface CodeAdapter {
  readonly name: string
  readonly description: string
  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown>
}

function validationError(msg: string): Error {
  return Object.assign(new Error(msg), { failureClass: 'fatal' })
}
function unknownOpError(op: string): Error {
  return Object.assign(new Error(`Unknown operation: ${op}`), { failureClass: 'fatal' })
}

const SITE = 'https://www.indeed.com'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function navigateAndWait(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)
}

/* ---------- operations ---------- */

async function searchJobs(page: Page, params: Record<string, unknown>) {
  const q = String(params.q || '')
  if (!q) throw validationError('q (search query) is required')
  const l = params.l ? String(params.l) : ''
  const start = Number(params.start) || 0
  const url = new URL('/jobs', SITE)
  url.searchParams.set('q', q)
  if (l) url.searchParams.set('l', l)
  if (start > 0) url.searchParams.set('start', String(start))
  await navigateAndWait(page, url.toString())
  return page.evaluate(`
    (() => {
      const result = {};
      const init = window._initialData;
      if (init) {
        result.totalJobCount = init.totalJobCount;
        result.uniqueJobsCount = init.uniqueJobsCount;
        result.pageNum = init.pageNum;
      }
      const pd = window.mosaic?.providerData?.['mosaic-provider-jobcards'];
      const model = pd?.metaData?.mosaicProviderJobCardsModel;
      if (model?.results) {
        result.jobs = model.results.map(r => ({
          jobkey: r.jobkey,
          title: r.displayTitle || r.title,
          company: r.company || r.truncatedCompany,
          companyRating: r.companyRating,
          companyReviewCount: r.companyReviewCount,
          location: r.formattedLocation,
          remoteLocation: r.remoteLocation,
          salary: r.extractedSalary || r.salarySnippet,
          snippet: r.snippet,
          formattedRelativeTime: r.formattedRelativeTime,
          jobTypes: r.jobTypes,
          link: r.link,
          indeedApplyEnabled: r.indeedApplyEnabled,
          urgentlyHiring: r.urgentlyHiring,
          newJob: r.newJob,
        }));
      }
      return result;
    })()
  `)
}

async function getJobDetail(page: Page, params: Record<string, unknown>) {
  const jk = String(params.jk || '')
  if (!jk) throw validationError('jk (job key) is required')
  await navigateAndWait(page, `${SITE}/viewjob?jk=${encodeURIComponent(jk)}`)
  return page.evaluate(`
    (() => {
      const result = {};
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        try {
          const data = JSON.parse(s.textContent || '');
          if (data['@type'] === 'JobPosting') {
            result.title = data.title;
            result.description = data.description;
            result.datePosted = data.datePosted;
            result.baseSalary = data.baseSalary;
            result.employmentType = data.employmentType;
            result.hiringOrganization = data.hiringOrganization;
            result.jobLocation = data.jobLocation;
            result.directApply = data.directApply;
          }
        } catch {}
      }
      const init = window._initialData;
      if (init) {
        result.jobKey = init.jobKey;
        if (!result.title) result.title = init.jobTitle;
        result.jobLocation = result.jobLocation || init.jobLocation;
        result.salaryInfoModel = init.salaryInfoModel;
        result.benefitsModel = init.benefitsModel;
        result.hiringInsightsModel = init.hiringInsightsModel;
        result.companyInfo = init.companyTabModel;
      }
      return result;
    })()
  `)
}

async function getSalary(page: Page, params: Record<string, unknown>) {
  const title = String(params.title || '')
  if (!title) throw validationError('title (job title) is required')
  const location = params.location ? String(params.location) : ''
  const slug = title.toLowerCase().replace(/\\s+/g, '-')
  const url = location
    ? `${SITE}/career/${encodeURIComponent(slug)}/salaries/${encodeURIComponent(location)}`
    : `${SITE}/career/${encodeURIComponent(slug)}/salaries`
  await navigateAndWait(page, url)
  return page.evaluate(`
    (() => {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el?.textContent) return { error: 'No salary data found' };
      try {
        const data = JSON.parse(el.textContent);
        const props = data?.props?.pageProps;
        if (!props) return { error: 'No pageProps found' };
        return {
          titleInfo: props.titleInfo,
          locationInfo: props.locationInfo,
          nationalSalaryAggregate: props.nationalSalaryAggregate,
          localSalaryAggregate: props.localSalaryAggregate,
          topPaidCities: props.topPaidCities,
          topPayingCompanies: props.topPayingCompanies,
          relatedTitlesResponse: props.relatedTitlesResponse,
        };
      } catch { return { error: 'Failed to parse salary data' }; }
    })()
  `)
}

async function getCompanyOverview(page: Page, params: Record<string, unknown>) {
  const company = String(params.company || '')
  if (!company) throw validationError('company (company slug) is required')
  await navigateAndWait(page, `${SITE}/cmp/${encodeURIComponent(company)}`)
  return page.evaluate(`
    (() => {
      const result = {};
      const init = window._initialData;
      if (init) {
        result.companyName = init.companyName;
        result.about = init.aboutSectionViewModel;
        result.ratings = init.reviewRatingOverallSectionViewModel;
        result.salaries = init.salarySectionViewModel;
        result.jobs = init.jobsSectionViewModel;
        result.locations = init.locationsSectionViewModel;
        result.interviews = init.interviewsSectionViewModel;
        result.faq = init.faqSectionViewModel;
        result.similarCompanies = init.similarCompaniesSectionViewModel;
        result.header = init.companyPageHeader;
      }
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        try {
          const data = JSON.parse(s.textContent || '');
          if (data['@type'] === 'LocalBusiness') result.ldJson = data;
        } catch {}
      }
      return result;
    })()
  `)
}

async function getCompanyReviews(page: Page, params: Record<string, unknown>) {
  const company = String(params.company || '')
  if (!company) throw validationError('company (company slug) is required')
  const filter = params.filter ? String(params.filter) : ''
  const url = filter
    ? `${SITE}/cmp/${encodeURIComponent(company)}/reviews?${filter}`
    : `${SITE}/cmp/${encodeURIComponent(company)}/reviews`
  await navigateAndWait(page, url)
  return page.evaluate(`
    (() => {
      const result = {};
      const ratingEl = document.querySelector('[data-testid="annotatedReviewRating"]');
      if (ratingEl) result.overallRating = ratingEl.textContent?.trim();
      const title = document.title;
      const countMatch = title.match(/([\\ d,]+)\\s+Reviews/);
      if (countMatch) result.reviewCount = countMatch[1];
      const reviewEls = document.querySelectorAll('[data-testid="reviewCard"], [itemprop="review"]');
      const reviews = [];
      for (const el of reviewEls) {
        const review = {};
        review.title = el.querySelector('[itemprop="name"], [data-testid="reviewTitle"]')?.textContent?.trim();
        review.rating = el.querySelector('[itemprop="ratingValue"]')?.getAttribute('content')
          || el.querySelector('[class*="ratingNumber"]')?.textContent?.trim();
        review.author = el.querySelector('[itemprop="author"]')?.textContent?.trim();
        review.date = el.querySelector('[itemprop="datePublished"]')?.getAttribute('content')
          || el.querySelector('[class*="reviewDate"]')?.textContent?.trim();
        review.pros = el.querySelector('[data-testid="reviewPros"], [class*="pros"]')?.textContent?.trim();
        review.cons = el.querySelector('[data-testid="reviewCons"], [class*="cons"]')?.textContent?.trim();
        review.jobTitle = el.querySelector('[data-testid="reviewJobTitle"]')?.textContent?.trim();
        review.location = el.querySelector('[data-testid="reviewLocation"]')?.textContent?.trim();
        if (review.title || review.rating) reviews.push(review);
      }
      result.reviews = reviews;
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        try {
          const data = JSON.parse(s.textContent || '');
          if (data['@type'] === 'EmployerAggregateRating' || data.aggregateRating) {
            result.aggregateRating = data.aggregateRating || data;
          }
        } catch {}
      }
      return result;
    })()
  `)
}

async function getCompanySalaries(page: Page, params: Record<string, unknown>) {
  const company = String(params.company || '')
  if (!company) throw validationError('company (company slug) is required')
  await navigateAndWait(page, `${SITE}/cmp/${encodeURIComponent(company)}/salaries`)
  return page.evaluate(`
    (() => {
      const result = {};
      result.companyName = document.querySelector('h1, [data-testid="companyName"]')?.textContent?.trim();
      const rows = document.querySelectorAll('[data-testid="salary-table-row"], table tbody tr');
      const salaries = [];
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          salaries.push({
            jobTitle: cells[0]?.textContent?.trim(),
            salary: cells[1]?.textContent?.trim(),
            salaryCount: cells[2]?.textContent?.trim(),
          });
        }
      }
      if (salaries.length > 0) { result.salaries = salaries; return result; }
      const cards = document.querySelectorAll('[data-testid="salaryCard"], [class*="salaryRow"]');
      if (cards.length > 0) {
        result.salaries = [...cards].map(c => ({
          jobTitle: c.querySelector('[class*="jobTitle"], a')?.textContent?.trim(),
          salary: c.querySelector('[class*="salary"], [class*="amount"]')?.textContent?.trim(),
        }));
      }
      return result;
    })()
  `)
}

async function autocompleteJobTitle(page: Page, params: Record<string, unknown>) {
  const q = String(params.q || '')
  if (!q) throw validationError('q (partial query) is required')
  const country = String(params.country || 'US')
  return page.evaluate(async ([query, ctry]: string[]) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const r = await fetch(
        `https://autocomplete.indeed.com/api/v0/suggestions/career-norm-job-title?query=${encodeURIComponent(query)}&country=${ctry}`,
        { signal: ctrl.signal },
      )
      return r.json()
    } finally { clearTimeout(timer) }
  }, [q, country])
}

async function autocompleteLocation(page: Page, params: Record<string, unknown>) {
  const q = String(params.q || '')
  if (!q) throw validationError('q (partial query) is required')
  const country = String(params.country || 'US')
  return page.evaluate(async ([query, ctry]: string[]) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const r = await fetch(
        `https://autocomplete.indeed.com/api/v0/suggestions/location?query=${encodeURIComponent(query)}&country=${ctry}`,
        { signal: ctrl.signal },
      )
      return r.json()
    } finally { clearTimeout(timer) }
  }, [q, country])
}

/* ---------- adapter export ---------- */

const adapter: CodeAdapter = {
  name: 'indeed-web',
  description: 'Indeed — job search, details, salary, company info via page extraction',

  async init(_page: Page): Promise<boolean> {
    return true
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // All ops are public reads
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    switch (operation) {
      case 'searchJobs': return searchJobs(page, { ...params })
      case 'getJobDetail': return getJobDetail(page, { ...params })
      case 'getSalary': return getSalary(page, { ...params })
      case 'getCompanyOverview': return getCompanyOverview(page, { ...params })
      case 'getCompanyReviews': return getCompanyReviews(page, { ...params })
      case 'getCompanySalaries': return getCompanySalaries(page, { ...params })
      case 'autocompleteJobTitle': return autocompleteJobTitle(page, { ...params })
      case 'autocompleteLocation': return autocompleteLocation(page, { ...params })
      default: throw unknownOpError(operation)
    }
  },
}

export default adapter
