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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function searchProducts(page: Page, params: Record<string, unknown>) {
  const k = String(params.k || '')
  if (!k) throw validationError('k (search keyword) is required')
  const pg = Number(params.page) || 1
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(k)}${pg > 1 ? `&page=${pg}` : ''}`
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)
  return page.evaluate(`
    (() => {
      const cards = document.querySelectorAll('[data-component-type="s-search-result"]');
      return {
        resultCount: cards.length,
        items: [...cards].map(c => ({
          asin: c.getAttribute('data-asin') || '',
          title: c.querySelector('h2 span')?.textContent?.trim() || '',
          price: c.querySelector('.a-price .a-offscreen')?.textContent?.trim() || '',
          rating: c.querySelector('.a-icon-alt')?.textContent?.trim() || '',
          link: 'https://www.amazon.com' + (c.querySelector('h2 a, a.a-link-normal.s-no-outline')?.getAttribute('href') || ''),
          image: c.querySelector('img.s-image')?.getAttribute('src') || '',
        })).filter(p => p.asin),
      };
    })()
  `)
}

async function getProductDetail(page: Page, params: Record<string, unknown>) {
  const asin = String(params.asin || '')
  if (!asin) throw validationError('asin is required')
  await page.goto(`https://www.amazon.com/dp/${asin}`, { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)
  return page.evaluate(`
    (() => {
      const g = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
      const a = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || '';
      return {
        name: g('#productTitle'),
        price: g('.a-price .a-offscreen'),
        brand: g('#bylineInfo'),
        rating: g('#acrPopover .a-icon-alt'),
        reviewCount: g('#acrCustomerReviewText'),
        image: a('#landingImage, #imgBlkFront', 'src'),
        description: g('#productDescription p, #productDescription span'),
        features: [...document.querySelectorAll('#feature-bullets li span.a-list-item')]
          .map(e => e.textContent?.trim())
          .filter(Boolean),
      };
    })()
  `)
}

async function getProductReviews(page: Page, params: Record<string, unknown>) {
  const asin = String(params.asin || '')
  if (!asin) throw validationError('asin is required')
  const pageNum = Number(params.pageNumber) || 1
  const sortBy = String(params.sortBy || 'helpful')
  let url = `https://www.amazon.com/product-reviews/${asin}?sortBy=${sortBy}`
  if (pageNum > 1) url += `&pageNumber=${pageNum}`
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)
  return page.evaluate(`
    (() => {
      const overallRating = document.querySelector('[data-hook="rating-out-of-text"]')?.textContent?.trim() || '';
      const totalReviews = document.querySelector('[data-hook="cr-filter-info-review-rating-count"]')?.textContent?.trim() || '';
      const reviews = document.querySelectorAll('[data-hook="review"]');
      return {
        overallRating,
        totalReviews,
        items: [...reviews].map(r => ({
          rating: r.querySelector('[data-hook="review-star-rating"] .a-icon-alt')?.textContent?.trim() || '',
          title: r.querySelector('[data-hook="review-title"] span:not(.a-icon-alt)')?.textContent?.trim() || '',
          body: r.querySelector('[data-hook="review-body"] span')?.textContent?.trim() || '',
          author: r.querySelector('.a-profile-name')?.textContent?.trim() || '',
          date: r.querySelector('[data-hook="review-date"]')?.textContent?.trim() || '',
        })),
      };
    })()
  `)
}

async function searchDeals(page: Page, params: Record<string, unknown>) {
  const startIndex = Number(params.startIndex) || 1
  const pageSize = Number(params.pageSize) || 20
  // Navigate to deals page to get proper cookies/context
  await page.goto('https://www.amazon.com/deals', { waitUntil: 'load', timeout: 30_000 })
  await wait(5000)

  const filters = String(params.filters || JSON.stringify({
    includedDepartments: [], excludedDepartments: [],
    includedTags: [], excludedTags: ['restrictedasin', 'noprime'],
    promotionTypes: [], accessTypes: [], brandIds: [], unifiedIds: [],
  }))
  const rankingContext = String(params.rankingContext || JSON.stringify({
    pageTypeId: 'deals', rankGroup: 'ESPEON_RANKING',
  }))

  // Must pass filters and rankingContext — API returns 400 "AAPI client validation failure" without them
  return page.evaluate(async ([si, ps, filt, rank]: string[]) => {
    const qs = new URLSearchParams({
      startIndex: si,
      pageSize: ps,
      calculateRefinements: 'false',
      filters: filt,
      rankingContext: rank,
    })
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    try {
      const r = await fetch(`/d2b/api/v1/products/search?${qs}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    } finally {
      clearTimeout(timer)
    }
  }, [String(startIndex), String(pageSize), filters, rankingContext])
}

async function getBestSellers(page: Page, _params: Record<string, unknown>) {
  await page.goto('https://www.amazon.com/gp/bestsellers/', { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)
  return page.evaluate(`
    (() => {
      const items = document.querySelectorAll('#gridItemRoot .zg-grid-general-faceout, [data-testid="grid-asin"]');
      return {
        items: [...items].map((el, i) => ({
          rank: i + 1,
          title: el.querySelector('.zg-truncate-text, ._cDEzb_p13n-sc-css-line-clamp-1_1Fn1y, [class*="truncate"]')?.textContent?.trim() || '',
          price: el.querySelector('.a-color-price, ._cDEzb_p13n-sc-price_3mJ9Z, [class*="price"]')?.textContent?.trim() || '',
          rating: el.querySelector('.a-icon-alt')?.textContent?.trim() || '',
          link: el.querySelector('a.a-link-normal')?.getAttribute('href') || '',
          image: el.querySelector('img')?.getAttribute('src') || '',
        })).filter(p => p.title),
      };
    })()
  `)
}

const adapter: CodeAdapter = {
  name: 'amazon',
  description: 'Amazon — search products, view details, read reviews, browse deals',

  async init(page: Page): Promise<boolean> {
    // Accept any page — each operation navigates to the correct URL
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
      case 'searchProducts': return searchProducts(page, { ...params })
      case 'getProductDetail': return getProductDetail(page, { ...params })
      case 'getProductReviews': return getProductReviews(page, { ...params })
      case 'searchDeals': return searchDeals(page, { ...params })
      case 'getBestSellers': return getBestSellers(page, { ...params })
      default: throw unknownOpError(operation)
    }
  },
}

export default adapter
