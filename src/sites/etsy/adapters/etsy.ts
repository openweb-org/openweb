import type { Page } from 'patchright'

/**
 * Etsy adapter — navigation + LD+JSON / DOM extraction.
 *
 * Cloudflare + PerimeterX + DataDome block direct HTTP. Data lives in
 * schema.org LD+JSON blocks and SSR-rendered DOM. We navigate to each
 * page surface and extract structured data.
 */

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
}

const BASE = 'https://www.etsy.com'

/** Navigate and wait for full page load (LD+JSON is in initial HTML). */
async function navigateAndWait(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(3000)
}

/** Parse all LD+JSON blocks from the page, returning them keyed by @type. */
async function getLdJson(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const result: Record<string, unknown> = {}
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const d = JSON.parse(s.textContent!)
        if (d['@type']) result[d['@type']] = d
      } catch { /* skip malformed */ }
    }
    return result
  })
}

// ---------------------------------------------------------------------------
// searchListings
// ---------------------------------------------------------------------------

async function searchListings(page: Page, params: Record<string, unknown>, errors: Errors) {
  const query = String(params.query || params.q || '')
  if (!query) throw errors.missingParam('query')

  const url = `${BASE}/search?q=${encodeURIComponent(query)}`
  await navigateAndWait(page, url)
  await page.waitForSelector('a[data-listing-id]', { timeout: 15_000 }).catch(() => {})

  const results = await page.evaluate(() => {
    const cards = document.querySelectorAll('a[data-listing-id]')
    const seen = new Set<string>()
    const listings: Record<string, unknown>[] = []

    for (const a of cards) {
      const id = a.getAttribute('data-listing-id')
      if (!id || seen.has(id)) continue
      seen.add(id)

      const card = a.closest('div[data-appears-component-name]') || a.closest('li') || a.parentElement?.parentElement
      if (!card) continue

      const text = card.innerText || ''
      const priceMatch = text.match(/\$[\d,.]+/)
      const ratingMatch = text.match(/([\d.]+)\s*\n\s*\(([\d,.k]+)\)/)

      // Extract shop name from "By ShopName" or "Ad・By ShopName"
      const shopMatch = text.match(/(?:Ad・)?By\s+(\S+)/i)

      const img = a.querySelector('img')
      const href = (a as HTMLAnchorElement).href

      listings.push({
        listingId: id,
        title: card.querySelector('h3')?.textContent?.trim() || '',
        url: href ? href.split('?')[0] : '',
        price: priceMatch ? priceMatch[0] : null,
        currency: 'USD',
        image: img?.src || '',
        shopName: shopMatch ? shopMatch[1] : '',
        rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
        reviewCount: ratingMatch ? ratingMatch[2] : null,
        freeShipping: text.includes('Free shipping'),
      })
    }
    return listings
  })

  return { query, totalResults: results.length, listings: results }
}

// ---------------------------------------------------------------------------
// getListingDetail
// ---------------------------------------------------------------------------

async function getListingDetail(page: Page, params: Record<string, unknown>, errors: Errors) {
  const listingId = String(params.listingId || params.id || '')
  if (!listingId) throw errors.missingParam('listingId')

  const url = `${BASE}/listing/${listingId}`
  await navigateAndWait(page, url)

  const ld = await getLdJson(page)
  const product = ld.Product as Record<string, unknown> | undefined
  if (!product) throw errors.fatal(`Listing ${listingId} not found`)

  const offers = (product.offers || {}) as Record<string, unknown>
  const rating = (product.aggregateRating || {}) as Record<string, unknown>
  const brand = (product.brand || {}) as Record<string, unknown>

  // Get photos from DOM (LD+JSON only has one image)
  const photos = await page.evaluate(() => {
    const imgs = document.querySelectorAll('img[src*="etsystatic.com"][src*="il_"]')
    const urls = new Set<string>()
    for (const img of imgs) {
      const src = (img as HTMLImageElement).src
      if (src.includes('il_fullxfull') || src.includes('il_794x')) urls.add(src)
    }
    return [...urls].slice(0, 10)
  })

  return {
    listingId: String(product.sku || listingId),
    title: String(product.name || ''),
    url: String(product.url || ''),
    description: String(product.description || ''),
    price: offers.price ? Number(offers.price) : null,
    currency: String(offers.priceCurrency || 'USD'),
    availability: String(offers.availability || '').replace('https://schema.org/', ''),
    shopName: String(brand.name || ''),
    category: String(product.category || ''),
    material: product.material ?? null,
    rating: rating.ratingValue ? Number(rating.ratingValue) : null,
    reviewCount: rating.reviewCount ? Number(rating.reviewCount) : null,
    photos,
    image: String(product.image || ''),
  }
}

// ---------------------------------------------------------------------------
// getReviews
// ---------------------------------------------------------------------------

async function getReviews(page: Page, params: Record<string, unknown>, errors: Errors) {
  const listingId = String(params.listingId || params.id || '')
  if (!listingId) throw errors.missingParam('listingId')

  const url = `${BASE}/listing/${listingId}`
  await navigateAndWait(page, url)

  const ld = await getLdJson(page)
  const product = ld.Product as Record<string, unknown> | undefined
  if (!product) throw errors.fatal(`Listing ${listingId} not found`)

  const aggregateRating = (product.aggregateRating || {}) as Record<string, unknown>
  const rawReviews = (product.review || []) as Record<string, unknown>[]

  const reviews = rawReviews.map(r => {
    const reviewRating = (r.reviewRating || {}) as Record<string, unknown>
    const author = (r.author || {}) as Record<string, unknown>
    return {
      rating: reviewRating.ratingValue ? Number(reviewRating.ratingValue) : null,
      text: String(r.reviewBody || ''),
      author: String(author.name || ''),
      date: String(r.datePublished || ''),
    }
  })

  return {
    listingId,
    averageRating: aggregateRating.ratingValue ? Number(aggregateRating.ratingValue) : null,
    totalReviews: aggregateRating.reviewCount ? Number(aggregateRating.reviewCount) : null,
    reviews,
  }
}

// ---------------------------------------------------------------------------
// getShop
// ---------------------------------------------------------------------------

async function getShop(page: Page, params: Record<string, unknown>, errors: Errors) {
  const shopName = String(params.shopName || params.name || '')
  if (!shopName) throw errors.missingParam('shopName')

  const url = `${BASE}/shop/${encodeURIComponent(shopName)}`
  await navigateAndWait(page, url)

  const ld = await getLdJson(page)
  const org = ld.Organization as Record<string, unknown> | undefined
  if (!org) throw errors.fatal(`Shop ${shopName} not found`)

  const rating = (org.aggregateRating || {}) as Record<string, unknown>
  const employees = (org.employee || []) as Record<string, unknown>[]

  // Extract sales count and years from DOM (not in LD+JSON)
  const domData = await page.evaluate(() => {
    const text = document.body?.innerText || ''
    const salesMatch = text.match(/([\d,.]+[kK]?)\s*sales/i)
    const yearsMatch = text.match(/(\d+)\s+years?\s+on\s+Etsy/i)
    const itemCount = document.querySelectorAll('[data-listing-id]').length
    return {
      sales: salesMatch ? salesMatch[1] : null,
      yearsOnEtsy: yearsMatch ? parseInt(yearsMatch[1]) : null,
      itemCount,
    }
  })

  return {
    shopName: String(org.name || shopName),
    description: String(org.description || ''),
    url: String(org.url || ''),
    logo: String(org.logo || ''),
    location: String(org.location || ''),
    slogan: org.slogan ? String(org.slogan) : null,
    owner: employees[0] ? String(employees[0].name || '') : null,
    rating: rating.ratingValue ? Number(rating.ratingValue) : null,
    reviewCount: rating.reviewCount ? Number(rating.reviewCount) : null,
    sales: domData.sales,
    yearsOnEtsy: domData.yearsOnEtsy,
    activeListings: domData.itemCount,
    image: org.image ? String(org.image) : null,
  }
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>> = {
  searchListings,
  getListingDetail,
  getReviews,
  getShop,
}

const adapter = {
  name: 'etsy',
  description: 'Etsy — search listings, listing details, reviews, and shop profiles via LD+JSON and DOM extraction',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('etsy.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // Public data, no login required
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: { errors: Errors }): Promise<unknown> {
    const { errors } = helpers
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page, { ...params }, errors)
  },
}

export default adapter
