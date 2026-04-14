import type { Page } from 'patchright'

const SITE = 'https://www.indeed.com'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function navigateAndWait(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)
}

/* ---------- operations ---------- */

async function searchJobs(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const q = String(params.q || '')
  if (!q) throw errors.missingParam('q')
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

async function getJobDetail(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const jk = String(params.jk || '')
  if (!jk) throw errors.missingParam('jk')
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

async function getSalary(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const title = String(params.title || '')
  if (!title) throw errors.missingParam('title')
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

async function getCompanyOverview(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const company = String(params.company || '')
  if (!company) throw errors.missingParam('company')
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

async function getCompanyReviews(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const company = String(params.company || '')
  if (!company) throw errors.missingParam('company')
  const filter = params.filter ? String(params.filter) : ''
  const url = filter
    ? `${SITE}/cmp/${encodeURIComponent(company)}/reviews?${filter}`
    : `${SITE}/cmp/${encodeURIComponent(company)}/reviews`
  await navigateAndWait(page, url)
  return page.evaluate(`
    (() => {
      const result = {};
      const init = window._initialData;
      if (init) {
        if (init.reviewsFilters) {
          const rc = init.reviewsFilters.reviewsCount;
          result.reviewCount = rc?.totalReviewCount ?? rc?.foundReviewCount ?? rc;
          result.topics = (init.reviewsFilters.topics || []).map(t => ({
            name: t.name, rating: t.rating, count: t.count,
          }));
        }
        const list = init.reviewsList;
        if (list) {
          result.companyName = list.companyName;
          result.reviews = (list.items || []).map(r => ({
            title: typeof r.title === 'object' ? r.title?.text : r.title,
            rating: r.overallRating,
            jobTitle: r.jobTitle || null,
            location: r.location || null,
            date: r.submissionDate,
            currentEmployee: r.currentEmployee,
            text: typeof r.text === 'object' ? r.text?.text : r.text,
            compensationRating: r.compensationAndBenefitsRating?.rating ?? null,
            cultureRating: r.cultureAndValuesRating?.rating ?? null,
            workLifeRating: r.workAndLifeBalanceRating?.rating ?? null,
            managementRating: r.managementRating?.rating ?? null,
            jobSecurityRating: r.jobSecurityAndAdvancementRating?.rating ?? null,
          }));
        }
      }
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

async function getCompanySalaries(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const company = String(params.company || '')
  if (!company) throw errors.missingParam('company')
  await navigateAndWait(page, `${SITE}/cmp/${encodeURIComponent(company)}/salaries`)
  return page.evaluate(`
    (() => {
      const result = {};
      const init = window._initialData;
      if (init) {
        result.companyName = init.companyName;
        if (init.salaryHeader) {
          result.totalSalaryCount = init.salaryHeader.totalSalaryCount;
          result.lastUpdated = init.salaryHeader.formattedLastUpdateDate;
        }
        const cats = init.categorySalarySection;
        if (cats && cats.categories) {
          result.categories = cats.categories.map(c => ({
            categoryTitle: c.categoryTitle,
            salaries: (c.salaries || []).map(s => ({
              jobTitle: s.title,
              salary: s.salary,
              salaryType: s.salaryType,
              reportedCount: s.reportedSalaryCount,
            })),
          }));
        }
        const popular = init.salaryPopularJobsSection;
        if (popular && popular.popularJobTitles) {
          result.popularJobs = popular.popularJobTitles.map(j => ({
            jobTitle: j.jobTitle,
            salary: j.formattedMedian,
            salaryPeriod: j.salaryPeriod,
          }));
        }
        if (init.salarySatisfactionSidebarWidget) {
          result.satisfaction = {
            totalCount: init.salarySatisfactionSidebarWidget.totalCount,
            yesRatio: init.salarySatisfactionSidebarWidget.yesRatio,
          };
        }
      }
      return result;
    })()
  `)
}

async function autocompleteJobTitle(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const q = String(params.q || '')
  if (!q) throw errors.missingParam('q')
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

async function autocompleteLocation(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const q = String(params.q || '')
  if (!q) throw errors.missingParam('q')
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

const adapter = {
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
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { errors } = helpers as { errors: { unknownOp(op: string): Error; missingParam(name: string): Error } }
    switch (operation) {
      case 'searchJobs': return searchJobs(page, { ...params }, errors)
      case 'getJobDetail': return getJobDetail(page, { ...params }, errors)
      case 'getSalary': return getSalary(page, { ...params }, errors)
      case 'getCompanyOverview': return getCompanyOverview(page, { ...params }, errors)
      case 'getCompanyReviews': return getCompanyReviews(page, { ...params }, errors)
      case 'getCompanySalaries': return getCompanySalaries(page, { ...params }, errors)
      case 'autocompleteJobTitle': return autocompleteJobTitle(page, { ...params }, errors)
      case 'autocompleteLocation': return autocompleteLocation(page, { ...params }, errors)
      default: throw errors.unknownOp(operation)
    }
  },
}

export default adapter
