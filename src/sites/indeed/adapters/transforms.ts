import type { Page, Response as PwResponse } from 'playwright-core'
import { OpenWebError } from '../../../lib/errors.js'

export const SITE = 'https://www.indeed.com'

/* ---------- helpers ---------- */

export async function navigateAndWait(page: Page, url: string, timeout = 30000): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
  await page.waitForTimeout(3000)
}

export async function extractNextData(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__')
    if (!el?.textContent) return null
    try {
      return JSON.parse(el.textContent)
    } catch {
      // intentional: malformed __NEXT_DATA__ JSON in page context
      return null
    }
  })
}

export async function extractLdJson(page: Page, type: string): Promise<Record<string, unknown> | null> {
  return page.evaluate((targetType) => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] === targetType) return data
      } catch { /* skip */ }
    }
    return null
  }, type)
}

/* ---------- operations ---------- */

export async function getCompanyReviews(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const company = String(params.company ?? '')
  if (!company) throw OpenWebError.missingParam('company')
  const filterParams = params.filter ? String(params.filter) : ''

  const url = filterParams
    ? `${SITE}/cmp/${encodeURIComponent(company)}/reviews?${filterParams}`
    : `${SITE}/cmp/${encodeURIComponent(company)}/reviews`

  // Intercept the review-filter API for metadata
  const filterPromise = page.waitForResponse(
    (resp: PwResponse) => resp.url().includes('/cmp/_rpc/review-filter') && resp.status() === 200,
    { timeout: 10000 },
  ).catch(() => null)

  await navigateAndWait(page, url)

  // Extract reviews from DOM
  const reviewData = await page.evaluate(() => {
    const result: Record<string, unknown> = {}

    // Overall rating
    const ratingEl = document.querySelector('[data-testid="annotatedReviewRating"]')
    if (ratingEl) result.overallRating = ratingEl.textContent?.trim()

    // Review count from page title
    const title = document.title
    const countMatch = title.match(/([\d,]+)\s+Reviews/)
    if (countMatch) result.reviewCount = countMatch[1]

    // Individual reviews
    const reviewEls = document.querySelectorAll('[data-testid="reviewCard"], [itemprop="review"]')
    const reviews: Record<string, unknown>[] = []
    for (const el of reviewEls) {
      const review: Record<string, unknown> = {}
      review.title = el.querySelector('[itemprop="name"], [data-testid="reviewTitle"]')?.textContent?.trim()
      review.rating = el.querySelector('[itemprop="ratingValue"]')?.getAttribute('content') ||
        el.querySelector('[class*="ratingNumber"]')?.textContent?.trim()
      review.author = el.querySelector('[itemprop="author"]')?.textContent?.trim()
      review.date = el.querySelector('[itemprop="datePublished"]')?.getAttribute('content') ||
        el.querySelector('[class*="reviewDate"]')?.textContent?.trim()
      review.pros = el.querySelector('[data-testid="reviewPros"], [class*="pros"]')?.textContent?.trim()
      review.cons = el.querySelector('[data-testid="reviewCons"], [class*="cons"]')?.textContent?.trim()
      review.jobTitle = el.querySelector('[data-testid="reviewJobTitle"]')?.textContent?.trim()
      review.location = el.querySelector('[data-testid="reviewLocation"]')?.textContent?.trim()
      if (review.title || review.rating) reviews.push(review)
    }
    result.reviews = reviews

    // LD+JSON
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] === 'EmployerAggregateRating' || data.aggregateRating) {
          result.aggregateRating = data.aggregateRating || data
        }
      } catch { /* skip */ }
    }

    return result
  })

  // Add filter metadata from API if captured
  const filterResp = await filterPromise
  if (filterResp) {
    try {
      const filterData = await filterResp.json()
      ;(reviewData as any).filterMetadata = {
        jobTitleCount: filterData.jobTitles?.length,
        locationCount: filterData.localLocations?.length,
        categoryCount: filterData.jobCategories?.length,
      }
    } catch { /* skip */ }
  }

  return reviewData
}

export async function browseJobCategories(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  await navigateAndWait(page, `${SITE}/browsejobs`)

  return page.evaluate(() => {
    const result: Record<string, unknown> = {}
    const sections: Record<string, unknown>[] = []

    // Indeed's browsejobs page has sections: "Companies by letter", "Jobs by title", etc.
    const sectionEls = document.querySelectorAll('section[role="region"]')
    for (const section of sectionEls) {
      const heading = section.querySelector('h2')?.textContent?.trim()
      const links: { name: string; url: string }[] = []
      for (const a of section.querySelectorAll('a')) {
        const text = (a as HTMLAnchorElement).textContent?.trim()
        const href = (a as HTMLAnchorElement).href
        if (text && href) links.push({ name: text, url: href })
      }
      if (heading) sections.push({ heading, links })
    }

    result.sections = sections
    result.title = document.querySelector('h1')?.textContent?.trim()
    return result
  })
}
