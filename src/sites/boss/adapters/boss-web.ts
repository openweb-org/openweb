import type { Page } from 'patchright'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
import type { CodeAdapter } from '../../../types/adapter.js'

/**
 * Boss直聘 L3 adapter — page-based job search, detail, company, and salary data.
 *
 * All operations use page transport (DOM extraction or page.evaluate(fetch)).
 * Bot detection blocks new automated tabs — requires human-established browser session.
 */

const SITE = 'https://www.zhipin.com'

async function navigateTo(page: Page, url: string, waitSelector?: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {})
  const selector = waitSelector ?? '.inner-wrap, [class*="job-"], [class*="company-"]'
  await page.waitForSelector(selector, { timeout: 10_000 }).catch(() => {})
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

  await navigateTo(page, url.toString(), '.job-card-wrap, .job-card-wrapper')

  return page.evaluate(() => {
    const result: Record<string, unknown> = {}
    const jobs: Record<string, unknown>[] = []

    const cards = document.querySelectorAll('.job-card-wrap, .job-card-wrapper')
    for (const card of cards) {
      const job: Record<string, unknown> = {}
      job.jobName = card.querySelector('.job-name')?.textContent?.trim()
      job.salaryDesc = card.querySelector('.job-salary, .salary')?.textContent?.trim() || ''

      // Company name and link from footer boss-info
      const companyLink = card.querySelector('.boss-info[href*="gongsi"], a[href*="gongsi"]') as HTMLAnchorElement
      job.company = card.querySelector('.boss-name')?.textContent?.trim() || ''
      job.companyLink = companyLink?.getAttribute('href') || ''

      job.area = card.querySelector('.company-location, .job-area')?.textContent?.trim() || ''

      const tagItems = card.querySelectorAll('.tag-list li')
      const tags: string[] = []
      for (const t of tagItems) { const text = t.textContent?.trim(); if (text) tags.push(text) }
      if (tags.length > 0) { job.experience = tags[0]; job.degree = tags[1] }

      const link = card.querySelector('a.job-name, a[href*="job_detail"]') as HTMLAnchorElement
      job.jobLink = link?.getAttribute('href') || ''

      if (job.jobName) jobs.push(job)
    }

    result.jobs = jobs
    const countEl = document.querySelector('[class*="result-num"], .search-job-result .job-tab')
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

  await navigateTo(page, url, '.job-sec-text, .job-detail-section, .job-banner')

  return page.evaluate(() => {
    const result: Record<string, unknown> = {}

    // Job title and salary from banner
    result.jobName = document.querySelector('.info-primary .name h1, .name h1')?.textContent?.trim() || ''
    result.salaryDesc = document.querySelector('.info-primary .name .salary, .salary')?.textContent?.trim() || ''

    // City, experience, degree from info-primary paragraph
    result.city = document.querySelector('.text-city')?.textContent?.trim() || ''
    result.experience = document.querySelector('.text-experiece, .text-experience')?.textContent?.trim() || ''
    result.degree = document.querySelector('.text-degree')?.textContent?.trim() || ''

    // Job description
    result.jobDescription = document.querySelector('.job-sec-text')?.innerHTML?.trim() || ''

    // Skill tags (from .job-keyword-list, NOT .job-tags which are benefits)
    const skillEls = document.querySelectorAll('.job-keyword-list li')
    const skills: string[] = []
    for (const el of skillEls) { const text = el.textContent?.trim(); if (text) skills.push(text) }
    if (skills.length > 0) result.tags = skills

    // Company info from .sider-company
    const company: Record<string, unknown> = {}
    const companyLink = document.querySelector('.sider-company a[href*="gongsi"]') as HTMLAnchorElement
    company.name = companyLink?.getAttribute('title') || companyLink?.textContent?.trim() || ''
    company.link = companyLink?.getAttribute('href') || ''

    // Stage, size, industry from .sider-company > p with icon classes
    const stageEl = document.querySelector('.sider-company .icon-stage')
    if (stageEl?.parentElement) company.stage = stageEl.parentElement.textContent?.trim() || ''
    const scaleEl = document.querySelector('.sider-company .icon-scale')
    if (scaleEl?.parentElement) company.size = scaleEl.parentElement.textContent?.trim() || ''
    const industryEl = document.querySelector('.sider-company .icon-industry')
    if (industryEl?.parentElement) company.industry = industryEl.parentElement.textContent?.trim() || ''
    result.company = company

    // Boss/recruiter info
    const boss: Record<string, unknown> = {}
    const bossNameEl = document.querySelector('.job-boss-info .name')
    if (bossNameEl) {
      // Get name text without child element text (e.g. "今日活跃")
      let nameText = ''
      for (const node of bossNameEl.childNodes) {
        if (node.nodeType === 3) nameText += node.textContent
      }
      boss.name = nameText.trim()
    }
    boss.title = document.querySelector('.job-boss-info .boss-info-attr')?.textContent?.trim() || ''
    result.boss = boss

    result.address = document.querySelector('.location-address')?.textContent?.trim() || ''

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

  await navigateTo(page, url, '.company-banner, [class*="company-banner"]')

  return page.evaluate(() => {
    const result: Record<string, unknown> = {}

    // Company name from banner h1 (extract first text node, exclude "收藏" button)
    const nameEl = document.querySelector('.company-banner .info h1.name, .company-banner h1.name')
    if (nameEl) {
      let nameText = ''
      for (const node of nameEl.childNodes) {
        if (node.nodeType === 3) nameText += node.textContent
      }
      result.name = nameText.trim()
    } else {
      result.name = ''
    }

    // Stage, size, industry from info paragraph (delimited by <em class="dolt">)
    const infoP = document.querySelector('.company-banner .info p')
    if (infoP) {
      const parts: string[] = []
      for (const node of infoP.childNodes) {
        if (node.nodeType === 3) {
          const t = node.textContent?.trim()
          if (t) parts.push(t)
        } else if (node.nodeType === 1) {
          const el = node as Element
          if (el.classList?.contains('dolt')) continue
          const t = el.textContent?.trim()
          if (t) parts.push(t)
        }
      }
      result.stage = parts[0] || ''; result.size = parts[1] || ''; result.industry = parts[2] || ''
    }

    result.description = document.querySelector('.fold-text, .company-description .text, .detail-content')?.textContent?.trim() || ''
    result.address = document.querySelector('.location-address, .company-address')?.textContent?.trim() || ''

    // Open positions from job list
    const jobEls = document.querySelectorAll('.job-list li')
    const jobs: Record<string, unknown>[] = []
    for (const el of jobEls) {
      const job: Record<string, unknown> = {}
      const titleLink = el.querySelector('.job-title, a[href*="job_detail"]') as HTMLAnchorElement
      job.jobName = titleLink?.textContent?.trim()
      job.salaryDesc = el.querySelector('.salary')?.textContent?.trim() || ''
      job.area = el.querySelector('.job-area')?.textContent?.trim() || ''
      job.link = titleLink?.getAttribute('href') || ''
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

  await navigateTo(page, url.toString(), '.job-card-wrap, .job-card-wrapper')

  return page.evaluate(() => {
    const salaries: Array<{ min: number; max: number; unit: string; name: string }> = []

    const cards = document.querySelectorAll('.job-card-wrap, .job-card-wrapper')
    for (const card of cards) {
      const salaryText = card.querySelector('.job-salary, .salary')?.textContent?.trim()
      if (!salaryText) continue

      const match = salaryText.match(/(\d+)-(\d+)(K|k|元\/天|元\/月)/)
      if (match) {
        const multiplier = match[3].toLowerCase() === 'k' ? 1000 : 1
        salaries.push({
          min: Number(match[1]) * multiplier,
          max: Number(match[2]) * multiplier,
          unit: match[3].toLowerCase() === 'k' ? 'CNY/month' : 'CNY/day',
          name: card.querySelector('.job-name')?.textContent?.trim() || '',
        })
      }
    }

    if (salaries.length === 0) return { salaryCount: 0, salaries: [] }

    const monthlySalaries = salaries.filter(s => s.unit === 'CNY/month')
    if (monthlySalaries.length === 0) return { salaryCount: 0, salaries: [] }

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
      samples: monthlySalaries.slice(0, 5).map(s => ({
        jobName: s.name,
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
    return page.url().includes('zhipin.com') || page.url().startsWith('about:')
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
