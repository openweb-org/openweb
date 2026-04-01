import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
import type { CodeAdapter } from '../../../types/adapter.js'

/**
 * Boss直聘 L3 adapter — page-based job search, detail, company, and salary data.
 *
 * All operations use page transport (DOM extraction or page.evaluate(fetch)).
 * Bot detection blocks new automated tabs — requires human-established browser session.
 */

const SITE = 'https://www.zhipin.com'

async function navigateAndWait(page: Page, url: string, timeout = 30_000): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
  await page.waitForTimeout(5000)
}

async function fetchJson(page: Page, url: string): Promise<unknown> {
  return page.evaluate(async (apiUrl) => {
    const resp = await fetch(apiUrl, { credentials: 'include' })
    return resp.json()
  }, url)
}

/* ---------- searchJobs ---------- */

async function searchJobs(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
  const city = String(params.city ?? '101010100')
  const pageNum = Number(params.page ?? 1)
  if (!query) throw OpenWebError.missingParam('query')

  const url = new URL('/web/geek/job', SITE)
  url.searchParams.set('query', query)
  url.searchParams.set('city', city)
  if (pageNum > 1) url.searchParams.set('page', String(pageNum))

  await navigateAndWait(page, url.toString())

  return page.evaluate(() => {
    const result: Record<string, unknown> = {}
    const jobs: Record<string, unknown>[] = []

    const cards = document.querySelectorAll('.job-card-wrapper, .search-job-result .job-card-body, [class*="job-card"]')
    for (const card of cards) {
      const job: Record<string, unknown> = {}
      job.jobName = card.querySelector('.job-name, [class*="job-name"], [ka="search_list_job_name"]')?.textContent?.trim()
      job.salaryDesc = card.querySelector('.salary, [class*="salary"]')?.textContent?.trim()
      job.company = (card.querySelector('.company-name a, [class*="company-name"]') as HTMLElement)?.textContent?.trim()
      job.companyLink = (card.querySelector('.company-name a, [class*="company-name"]') as HTMLAnchorElement)?.getAttribute('href') || ''
      job.area = card.querySelector('.job-area, [class*="job-area"]')?.textContent?.trim()

      const infoTags = card.querySelectorAll('.tag-list li, [class*="info-desc"]')
      const tags: string[] = []
      for (const t of infoTags) { const text = t.textContent?.trim(); if (text) tags.push(text) }
      if (tags.length > 0) { job.experience = tags[0]; job.degree = tags[1] }

      const link = card.querySelector('a[href*="job_detail"], a[ka="search_list_job"]')
      job.jobLink = (link as HTMLAnchorElement)?.getAttribute('href') || ''

      const companyInfoEl = card.querySelector('[class*="company-tag-list"]')
      const companyTags = companyInfoEl?.querySelectorAll('li')
      if (companyTags) {
        const ct: string[] = []
        for (const t of companyTags) ct.push(t.textContent?.trim() ?? '')
        job.industry = ct[0]; job.companyStage = ct[1]; job.companySize = ct[2]
      }

      job.bossName = card.querySelector('[class*="info-public"] em, .boss-name')?.textContent?.trim()
      job.bossTitle = card.querySelector('[class*="info-public"] span, .boss-title')?.textContent?.trim()

      if (job.jobName) jobs.push(job)
    }

    result.jobs = jobs
    const countEl = document.querySelector('[class*="result-num"], [class*="job-tab"]')
    if (countEl) {
      const match = countEl.textContent?.match(/(\d+)/)
      if (match) result.totalCount = Number.parseInt(match[1], 10)
    }
    return result
  })
}

/* ---------- getJobDetail ---------- */

async function getJobDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const jobId = String(params.jobId ?? '')
  if (!jobId) throw OpenWebError.missingParam('jobId')

  const url = jobId.startsWith('http') ? jobId
    : jobId.startsWith('/') ? `${SITE}${jobId}`
    : `${SITE}/job_detail/${jobId}`

  await navigateAndWait(page, url)

  return page.evaluate(() => {
    const result: Record<string, unknown> = {}
    result.jobName = document.querySelector('.name h1, [class*="job-banner"] .name, .job-title')?.textContent?.trim()
    result.salaryDesc = document.querySelector('.salary, [class*="salary"]')?.textContent?.trim()

    const infoTags = document.querySelectorAll('.job-detail-header .info-primary p, [class*="job-tags"] span')
    const tags: string[] = []
    for (const t of infoTags) tags.push(t.textContent?.trim() ?? '')
    if (tags.length > 0) { result.city = tags[0]; result.experience = tags[1]; result.degree = tags[2] }

    const descEl = document.querySelector('.job-detail-section .text, [class*="job-sec-text"], .job-detail .detail-content')
    result.jobDescription = descEl?.innerHTML?.trim()

    const skillEls = document.querySelectorAll('.job-tags .tag-item, [class*="job-keyword"] li')
    const skills: string[] = []
    for (const el of skillEls) { const text = el.textContent?.trim(); if (text) skills.push(text) }
    if (skills.length > 0) result.tags = skills

    const company: Record<string, unknown> = {}
    company.name = document.querySelector('.sider-company .company-name, [class*="company-info"] .name')?.textContent?.trim()
    const companyDetail = document.querySelectorAll('.sider-company p, [class*="company-info"] li')
    const companyInfos: string[] = []
    for (const el of companyDetail) companyInfos.push(el.textContent?.trim() ?? '')
    if (companyInfos.length > 0) { company.industry = companyInfos[0]; company.stage = companyInfos[1]; company.size = companyInfos[2] }
    const companyLink = document.querySelector('.sider-company a[href*="gongsi"], [class*="company-info"] a')
    company.link = (companyLink as HTMLAnchorElement)?.getAttribute('href') || ''
    result.company = company

    const boss: Record<string, unknown> = {}
    boss.name = document.querySelector('.boss-info .name, [class*="boss-info"] .name')?.textContent?.trim()
    boss.title = document.querySelector('.boss-info .title, [class*="boss-info"] .title')?.textContent?.trim()
    result.boss = boss
    result.address = document.querySelector('.location-address, [class*="job-location"]')?.textContent?.trim()

    return result
  })
}

/* ---------- getCompanyProfile ---------- */

async function getCompanyProfile(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const companyId = String(params.companyId ?? '')
  if (!companyId) throw OpenWebError.missingParam('companyId')

  const url = companyId.startsWith('http') ? companyId
    : companyId.startsWith('/') ? `${SITE}${companyId}`
    : `${SITE}/gongsi/${companyId}`

  await navigateAndWait(page, url)

  return page.evaluate(() => {
    const result: Record<string, unknown> = {}
    result.name = document.querySelector('.company-banner .name, .company-info h1, [class*="company-name"]')?.textContent?.trim()

    const infoEls = document.querySelectorAll('.company-banner .info p, [class*="company-info"] li')
    const infos: string[] = []
    for (const el of infoEls) infos.push(el.textContent?.trim() ?? '')
    result.industry = infos[0]; result.stage = infos[1]; result.size = infos[2]

    result.description = document.querySelector('.company-description .text, [class*="company-detail"] .fold-text')?.textContent?.trim()
    result.address = document.querySelector('.company-address, [class*="location-address"]')?.textContent?.trim()

    const jobEls = document.querySelectorAll('.company-jobs .job-card, [class*="job-list"] li')
    const jobs: Record<string, unknown>[] = []
    for (const el of jobEls) {
      const job: Record<string, unknown> = {}
      job.jobName = el.querySelector('.job-name, a')?.textContent?.trim()
      job.salaryDesc = el.querySelector('.salary, [class*="salary"]')?.textContent?.trim()
      job.area = el.querySelector('.job-area, [class*="area"]')?.textContent?.trim()
      const link = el.querySelector('a[href*="job_detail"]')
      job.link = (link as HTMLAnchorElement)?.getAttribute('href') || ''
      if (job.jobName) jobs.push(job)
    }
    result.jobs = jobs
    return result
  })
}

/* ---------- getSalary ---------- */

async function getSalary(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
  const city = String(params.city ?? '101010100')
  if (!query) throw OpenWebError.missingParam('query')

  const url = new URL('/web/geek/job', SITE)
  url.searchParams.set('query', query)
  url.searchParams.set('city', city)

  await navigateAndWait(page, url.toString())

  return page.evaluate(() => {
    const salaries: Array<{ min: number; max: number; unit: string }> = []

    const cards = document.querySelectorAll('.job-card-wrapper, [class*="job-card"]')
    for (const card of cards) {
      const salaryText = card.querySelector('.salary, [class*="salary"]')?.textContent?.trim()
      if (!salaryText) continue

      // Parse salary ranges like "15-25K", "15-25K·14薪", "20-40K·16薪"
      const match = salaryText.match(/(\d+)-(\d+)(K|k|元\/天|元\/月)/)
      if (match) {
        const multiplier = match[3].toLowerCase() === 'k' ? 1000 : 1
        salaries.push({
          min: Number(match[1]) * multiplier,
          max: Number(match[2]) * multiplier,
          unit: match[3].toLowerCase() === 'k' ? 'CNY/month' : 'CNY/day',
        })
      }
    }

    if (salaries.length === 0) return { query: '', salaryCount: 0, salaries: [] }

    const monthlySalaries = salaries.filter(s => s.unit === 'CNY/month')
    const mins = monthlySalaries.map(s => s.min).sort((a, b) => a - b)
    const maxs = monthlySalaries.map(s => s.max).sort((a, b) => a - b)

    const median = (arr: number[]) => {
      const mid = Math.floor(arr.length / 2)
      return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2)
    }
    const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)

    return {
      salaryCount: monthlySalaries.length,
      minRange: { lowest: mins[0], median: median(mins), highest: mins[mins.length - 1] },
      maxRange: { lowest: maxs[0], median: median(maxs), highest: maxs[maxs.length - 1] },
      averageMin: avg(mins),
      averageMax: avg(maxs),
      unit: 'CNY/month',
      samples: salaries.slice(0, 5).map((s, i) => ({
        jobName: document.querySelectorAll('.job-card-wrapper .job-name, [class*="job-card"] [class*="job-name"]')[i]?.textContent?.trim(),
        salary: `${s.min / 1000}-${s.max / 1000}K`,
      })),
    }
  })
}

/* ---------- reference data (page.evaluate(fetch), no navigation) ---------- */

async function getCities(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return fetchJson(page, `${SITE}/wapi/zpCommon/data/city.json`)
}

async function getIndustries(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return fetchJson(page, `${SITE}/wapi/zpCommon/data/industry.json`)
}

async function getFilterConditions(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return fetchJson(page, `${SITE}/wapi/zpgeek/pc/all/filter/conditions.json`)
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchJobs,
  getJobDetail,
  getCompanyProfile,
  getSalary,
  getCities,
  getIndustries,
  getFilterConditions,
}

const adapter: CodeAdapter = {
  name: 'boss-web',
  description: 'Boss直聘 — job search, detail, company profiles, salary data via page DOM extraction',

  async init(page: Page): Promise<boolean> {
    if (!page.url().includes('zhipin.com')) {
      try {
        await page.goto('https://www.zhipin.com/', { waitUntil: 'domcontentloaded', timeout: 15_000 })
      } catch { /* navigation may fail due to bot detection */ }
    }
    return page.url().includes('zhipin.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    // All operations work without login — requires_auth: false
    return true
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw OpenWebError.unknownOp(operation)
      return handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
