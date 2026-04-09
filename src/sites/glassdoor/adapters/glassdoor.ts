import type { Page } from 'patchright'

interface CodeAdapter {
  readonly name: string
  readonly description: string
  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown>
}

const GD_ORIGIN = 'https://www.glassdoor.com'
const CF_POLL_MS = 2_000
const CF_MAX_WAIT_MS = 30_000

async function isCloudflareBlocked(page: Page): Promise<boolean> {
  try {
    const title = await page.title()
    return title.includes('moment') || title.includes('Checking')
  } catch {
    return false
  }
}

async function waitForCloudflare(page: Page): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < CF_MAX_WAIT_MS) {
    if (!(await isCloudflareBlocked(page))) return
    await page.waitForTimeout(CF_POLL_MS)
  }
  throw Object.assign(
    new Error('Cloudflare challenge not resolved. Run `openweb browser restart --no-headless`, solve CAPTCHA if visible, then retry.'),
    { failureClass: 'bot_blocked' },
  )
}

async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await waitForCloudflare(page)
  await page.waitForTimeout(2_000)
}

/* ---------- searchCompanies ---------- */

async function searchCompanies(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const query = String(params.query ?? '')
  if (!query) throw new Error('query is required')

  await navigateTo(page, `${GD_ORIGIN}/Reviews/company-reviews.htm?sc.keyword=${encodeURIComponent(query)}`)

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

/* ---------- getReviews ---------- */

async function getReviews(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const employerId = params.employerId
  if (!employerId) throw new Error('employerId is required')

  await navigateTo(page, `${GD_ORIGIN}/Reviews/Company-Reviews-E${employerId}.htm`)
  await page.waitForSelector('article, [data-test*="review"]', { timeout: 10_000 }).catch(() => {})

  return page.evaluate(() => {
    const companyEl = document.querySelector('h1')
    const companyName = companyEl?.textContent?.trim()?.replace(/\s*reviews$/i, '') ?? null

    const ratingEl = document.querySelector('[class*="ratingNum"], [data-test="rating-info"]')
    const overallRating = ratingEl?.textContent?.trim() ?? null

    const articles = document.querySelectorAll('article')
    const reviews: Array<Record<string, string | null>> = []

    for (const article of articles) {
      const text = article.innerText ?? ''
      if (!text.includes('Pros') && !text.includes('Cons')) continue

      const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

      let rating: string | null = null
      let date: string | null = null
      let title: string | null = null
      let jobTitle: string | null = null
      let employeeStatus: string | null = null
      let pros: string | null = null
      let cons: string | null = null

      // Rating is usually first line like "4.0"
      for (const line of lines) {
        if (/^\d\.\d$/.test(line)) { rating = line; break }
      }

      // Date pattern
      for (const line of lines) {
        if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}$/i.test(line)) {
          date = line; break
        }
      }

      // Title is usually after the date
      const dateIdx = date ? lines.indexOf(date) : -1
      if (dateIdx >= 0 && dateIdx + 1 < lines.length) {
        title = lines[dateIdx + 1]
      }

      // Job title and employee status
      for (const line of lines) {
        if (line.includes('employee') || line.includes('Employee')) {
          const parts = line.split(',').map(p => p.trim())
          if (parts.length >= 1) {
            const jobPart = parts.find(p => !p.toLowerCase().includes('employee') && !p.toLowerCase().includes('year'))
            if (jobPart) jobTitle = jobPart
            const statusPart = parts.find(p => p.toLowerCase().includes('employee'))
            if (statusPart) employeeStatus = statusPart
          }
        }
      }

      // Pros and Cons
      const prosIdx = lines.indexOf('Pros')
      const consIdx = lines.indexOf('Cons')
      if (prosIdx >= 0 && prosIdx + 1 < lines.length) {
        pros = lines[prosIdx + 1]
      }
      if (consIdx >= 0 && consIdx + 1 < lines.length) {
        cons = lines[consIdx + 1]
      }

      if (title || pros || cons) {
        reviews.push({ rating, date, title, jobTitle, employeeStatus, pros, cons })
      }
    }
    return { companyName, overallRating, reviews }
  })
}

/* ---------- getSalaries ---------- */

async function getSalaries(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const employerId = params.employerId
  if (!employerId) throw new Error('employerId is required')

  await navigateTo(page, `${GD_ORIGIN}/Salary/Company-Salaries-E${employerId}.htm`)
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

/* ---------- getInterviews ---------- */

async function getInterviews(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const employerId = params.employerId
  if (!employerId) throw new Error('employerId is required')

  await navigateTo(page, `${GD_ORIGIN}/Interview/Company-Interview-Questions-E${employerId}.htm`)
  await page.waitForSelector('[class*="Interview"], article', { timeout: 10_000 }).catch(() => {})

  return page.evaluate(() => {
    const h1 = document.querySelector('h1')
    const companyName = h1?.textContent?.trim()?.replace(/\s*interview questions$/i, '') ?? null

    const diffEl = document.querySelector('[class*="DifficultyScore"], [class*="difficulty"]')
    const difficulty = diffEl?.textContent?.replace(/^Difficulty\s*/i, '')?.trim()?.split('\n')[0] ?? null

    const countMatch = document.body.innerText.match(/([\d,]+)\s+interviews?/i)
    const interviewCount = countMatch ? countMatch[1] : null

    const body = document.body.innerText
    const interviewBlocks = body.split(/(?=\w[\w\s]* Interview\n)/g)

    const interviews: Array<Record<string, string | null>> = []

    for (const block of interviewBlocks) {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
      if (lines.length < 3) continue

      const roleMatch = lines[0].match(/^(.+?)\s*Interview$/)
      if (!roleMatch) continue

      const role = roleMatch[1]
      let date: string | null = null
      let location: string | null = null
      let offerStatus: string | null = null
      let experience: string | null = null
      let interviewDifficulty: string | null = null
      let description: string | null = null

      for (const line of lines) {
        if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}$/i.test(line)) {
          date = line
        }
        if (line.includes('Declined offer') || line.includes('Accepted offer') || line.includes('No offer')) {
          offerStatus = line
        }
        if (line.includes('Positive experience') || line.includes('Negative experience') || line.includes('Neutral experience')) {
          experience = line.replace(/experience/i, '').trim()
        }
        if (line.includes('interview') && (line.includes('Easy') || line.includes('Average') || line.includes('Difficult'))) {
          interviewDifficulty = line.replace(/interview/i, '').trim()
        }
      }

      // Location is often on a line by itself (city, state format)
      for (const line of lines) {
        if (/^[A-Z][\w\s]+,\s*[A-Z]{2}$/.test(line) || /^[A-Z][\w\s]+,\s*[A-Z][\w\s]+$/.test(line)) {
          location = line; break
        }
      }

      // Description - look for "Interview" section content
      const appIdx = lines.findIndex(l => l.startsWith('I interviewed') || l.startsWith('I applied'))
      const interviewIdx = lines.indexOf('Interview')
      if (interviewIdx >= 0 && interviewIdx + 1 < lines.length) {
        description = lines[interviewIdx + 1]
      } else if (appIdx >= 0) {
        description = lines[appIdx]
      }

      interviews.push({ role, date, location, offerStatus, experience, difficulty: interviewDifficulty, description })
    }
    return { companyName, difficulty, interviewCount, interviews }
  })
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Readonly<Record<string, unknown>>) => Promise<unknown>> = {
  searchCompanies,
  getReviews,
  getSalaries,
  getInterviews,
}

const adapter: CodeAdapter = {
  name: 'glassdoor',
  description: 'Glassdoor — company reviews, salaries, interview experiences via DOM + SSR extraction',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('glassdoor.com') || url === 'about:blank'
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) {
      throw new Error(`Unknown operation: ${operation}. Available: ${Object.keys(OPERATIONS).join(', ')}`)
    }
    if (await isCloudflareBlocked(page)) {
      await waitForCloudflare(page)
    }
    return handler(page, params)
  },
}

export default adapter
