/**
 * Boss直聘 L3 adapter — page-based job search, detail, and company data.
 *
 * Boss直聘 (zhipin.com) is a Vue.js SPA with bot detection.
 * - L3 page adapter for search, job detail, company profile (requires browser session)
 * - L1-style API calls via page.evaluate(fetch) for reference data (cities, industries, etc.)
 *
 * The reference data APIs (cities, industries, positions, filters) respond without auth.
 * Job search and detail pages require a human-established browser session to bypass bot detection.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright-core'

const SITE = 'https://www.zhipin.com'

/* ---------- helpers ---------- */

async function navigateAndWait(page: Page, url: string, timeout = 30000): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
  await page.waitForTimeout(5000)
}

async function fetchJson(page: Page, url: string): Promise<unknown> {
  return page.evaluate(async (apiUrl) => {
    const resp = await fetch(apiUrl, { credentials: 'include' })
    return resp.json()
  }, url)
}

/* ---------- L3 page operations ---------- */

async function searchJobs(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
  const city = String(params.city ?? '101010100')
  const pageNum = Number(params.page ?? 1)
  if (!query) throw new Error('query is required')

  const url = new URL('/web/geek/job', SITE)
  url.searchParams.set('query', query)
  url.searchParams.set('city', city)
  if (pageNum > 1) url.searchParams.set('page', String(pageNum))

  await navigateAndWait(page, url.toString())

  return page.evaluate(() => {
    const result: Record<string, unknown> = {}
    const jobs: Record<string, unknown>[] = []

    // Extract job cards from rendered DOM
    const cards = document.querySelectorAll('.job-card-wrapper, .search-job-result .job-card-body, [class*="job-card"]')
    cards.forEach((card) => {
      const job: Record<string, unknown> = {}
      const nameEl = card.querySelector('.job-name, [class*="job-name"], [ka="search_list_job_name"]')
      job.jobName = nameEl?.textContent?.trim()

      const salaryEl = card.querySelector('.salary, [class*="salary"]')
      job.salaryDesc = salaryEl?.textContent?.trim()

      const companyEl = card.querySelector('.company-name a, [class*="company-name"]')
      job.company = companyEl?.textContent?.trim()
      job.companyLink = (companyEl as HTMLAnchorElement)?.getAttribute('href') || ''

      const areaEl = card.querySelector('.job-area, [class*="job-area"]')
      job.area = areaEl?.textContent?.trim()

      const infoTags = card.querySelectorAll('.tag-list li, [class*="info-desc"]')
      const tags: string[] = []
      infoTags.forEach((t) => {
        const text = t.textContent?.trim()
        if (text) tags.push(text)
      })
      if (tags.length > 0) {
        job.experience = tags[0]
        job.degree = tags[1]
      }

      const skillTags = card.querySelectorAll('.job-card-footer .tag-list li, [class*="tag"]')
      const skills: string[] = []
      skillTags.forEach((t) => {
        const text = t.textContent?.trim()
        if (text) skills.push(text)
      })
      if (skills.length > 0) job.tags = skills

      const link = card.querySelector('a[href*="job_detail"], a[ka="search_list_job"]')
      job.jobLink = (link as HTMLAnchorElement)?.getAttribute('href') || ''

      const companyInfoEl = card.querySelector('[class*="company-tag-list"]')
      const companyTags = companyInfoEl?.querySelectorAll('li')
      if (companyTags) {
        const ct: string[] = []
        companyTags.forEach((t) => ct.push(t.textContent?.trim() ?? ''))
        job.industry = ct[0]
        job.companyStage = ct[1]
        job.companySize = ct[2]
      }

      const bossEl = card.querySelector('[class*="info-public"] em, .boss-name')
      job.bossName = bossEl?.textContent?.trim()
      const bossTitleEl = card.querySelector('[class*="info-public"] span, .boss-title')
      job.bossTitle = bossTitleEl?.textContent?.trim()

      if (job.jobName) jobs.push(job)
    })

    result.jobs = jobs

    // Try to extract total count from page
    const countEl = document.querySelector('[class*="result-num"], [class*="job-tab"]')
    if (countEl) {
      const match = countEl.textContent?.match(/(\d+)/)
      if (match) result.totalCount = parseInt(match[1], 10)
    }

    return result
  })
}

async function getJobDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const jobId = String(params.jobId ?? '')
  if (!jobId) throw new Error('jobId is required')

  const url = jobId.startsWith('http') ? jobId :
    jobId.startsWith('/') ? `${SITE}${jobId}` :
    `${SITE}/job_detail/${jobId}`

  await navigateAndWait(page, url)

  return page.evaluate(() => {
    const result: Record<string, unknown> = {}

    result.jobName = document.querySelector('.name h1, [class*="job-banner"] .name, .job-title')?.textContent?.trim()
    result.salaryDesc = document.querySelector('.salary, [class*="salary"]')?.textContent?.trim()

    const detailItems = document.querySelectorAll('.job-detail .detail-content p, [class*="job-detail"]')
    const infos: string[] = []
    detailItems.forEach((el) => {
      const text = el.textContent?.trim()
      if (text) infos.push(text)
    })

    // Info tags (city, experience, degree)
    const infoTags = document.querySelectorAll('.job-detail-header .info-primary p, [class*="job-tags"] span')
    const tags: string[] = []
    infoTags.forEach((t) => tags.push(t.textContent?.trim() ?? ''))
    if (tags.length > 0) {
      result.city = tags[0]
      result.experience = tags[1]
      result.degree = tags[2]
    }

    // Job description
    const descEl = document.querySelector('.job-detail-section .text, [class*="job-sec-text"], .job-detail .detail-content')
    result.jobDescription = descEl?.innerHTML?.trim()

    // Tags/skills
    const skillEls = document.querySelectorAll('.job-tags .tag-item, [class*="job-keyword"] li')
    const skills: string[] = []
    skillEls.forEach((el) => {
      const text = el.textContent?.trim()
      if (text) skills.push(text)
    })
    if (skills.length > 0) result.tags = skills

    // Company info
    const company: Record<string, unknown> = {}
    company.name = document.querySelector('.sider-company .company-name, [class*="company-info"] .name')?.textContent?.trim()
    const companyDetail = document.querySelectorAll('.sider-company p, [class*="company-info"] li')
    const companyInfos: string[] = []
    companyDetail.forEach((el) => companyInfos.push(el.textContent?.trim() ?? ''))
    if (companyInfos.length > 0) {
      company.industry = companyInfos[0]
      company.stage = companyInfos[1]
      company.size = companyInfos[2]
    }
    const companyLink = document.querySelector('.sider-company a[href*="gongsi"], [class*="company-info"] a')
    company.link = (companyLink as HTMLAnchorElement)?.getAttribute('href') || ''
    result.company = company

    // Boss info
    const boss: Record<string, unknown> = {}
    boss.name = document.querySelector('.boss-info .name, [class*="boss-info"] .name')?.textContent?.trim()
    boss.title = document.querySelector('.boss-info .title, [class*="boss-info"] .title')?.textContent?.trim()
    result.boss = boss

    // Address
    result.address = document.querySelector('.location-address, [class*="job-location"]')?.textContent?.trim()
    result.area = document.querySelector('.job-detail-header .info-primary span, [class*="job-area"]')?.textContent?.trim()

    return result
  })
}

async function getCompanyProfile(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const companyId = String(params.companyId ?? '')
  if (!companyId) throw new Error('companyId is required')

  const url = companyId.startsWith('http') ? companyId :
    companyId.startsWith('/') ? `${SITE}${companyId}` :
    `${SITE}/gongsi/${companyId}`

  await navigateAndWait(page, url)

  return page.evaluate(() => {
    const result: Record<string, unknown> = {}

    result.name = document.querySelector('.company-banner .name, .company-info h1, [class*="company-name"]')?.textContent?.trim()

    const infoEls = document.querySelectorAll('.company-banner .info p, [class*="company-info"] li')
    const infos: string[] = []
    infoEls.forEach((el) => infos.push(el.textContent?.trim() ?? ''))
    result.industry = infos[0]
    result.stage = infos[1]
    result.size = infos[2]

    result.description = document.querySelector('.company-description .text, [class*="company-detail"] .fold-text')?.textContent?.trim()
    result.address = document.querySelector('.company-address, [class*="location-address"]')?.textContent?.trim()

    // Extract job listings
    const jobEls = document.querySelectorAll('.company-jobs .job-card, [class*="job-list"] li')
    const jobs: Record<string, unknown>[] = []
    jobEls.forEach((el) => {
      const job: Record<string, unknown> = {}
      job.jobName = el.querySelector('.job-name, a')?.textContent?.trim()
      job.salaryDesc = el.querySelector('.salary, [class*="salary"]')?.textContent?.trim()
      job.area = el.querySelector('.job-area, [class*="area"]')?.textContent?.trim()
      job.experience = el.querySelector('[class*="info"] span')?.textContent?.trim()
      const link = el.querySelector('a[href*="job_detail"]')
      job.link = (link as HTMLAnchorElement)?.getAttribute('href') || ''
      if (job.jobName) jobs.push(job)
    })
    result.jobs = jobs

    return result
  })
}

/* ---------- L1-style API operations (via page.evaluate fetch) ---------- */

async function getCities(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return fetchJson(page, `${SITE}/wapi/zpCommon/data/city.json`)
}

async function getIndustries(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return fetchJson(page, `${SITE}/wapi/zpCommon/data/industry.json`)
}

async function getPositionCategories(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return fetchJson(page, `${SITE}/wapi/zpCommon/data/getCityShowPosition`)
}

async function getFilterConditions(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return fetchJson(page, `${SITE}/wapi/zpgeek/pc/all/filter/conditions.json`)
}

async function getBusinessDistricts(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const cityCode = String(params.cityCode ?? '101010100')
  return fetchJson(page, `${SITE}/wapi/zpgeek/businessDistrict.json?cityCode=${cityCode}`)
}

async function getSubwayStations(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const cityCode = String(params.cityCode ?? '101010100')
  return fetchJson(page, `${SITE}/wapi/zpCommon/data/getSubwayByCity?cityCode=${cityCode}`)
}

async function getCityGroups(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return fetchJson(page, `${SITE}/wapi/zpCommon/data/cityGroup.json`)
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchJobs,
  getJobDetail,
  getCompanyProfile,
  getCities,
  getIndustries,
  getPositionCategories,
  getFilterConditions,
  getBusinessDistricts,
  getSubwayStations,
  getCityGroups,
}

const adapter: CodeAdapter = {
  name: 'boss-web',
  description:
    'Boss直聘 — job search, detail, company profiles, and reference data via page navigation + API extraction',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('zhipin.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://www.zhipin.com')
    return cookies.some((c) => c.name === '__zp_stoken__')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) throw new Error(`Unknown operation: ${operation}`)
    return handler(page, { ...params })
  },
}

export default adapter
