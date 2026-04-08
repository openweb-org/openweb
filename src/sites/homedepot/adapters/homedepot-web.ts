import type { Page, Response as PwResponse } from 'patchright'

/**
 * Home Depot L3 adapter — navigation-based GraphQL interception + DOM extraction.
 *
 * Akamai blocks programmatic `page.evaluate(fetch(...))` on the federation gateway.
 * Instead we navigate to the search/product pages and intercept the GraphQL responses
 * that the page's own JS triggers naturally.
 */

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BASE = 'https://www.homedepot.com'
const GRAPHQL_PATH = '/federation-gateway/graphql'

/** Intercept a GraphQL response by navigating to a page that triggers it. */
async function interceptGraphQL(
  page: Page,
  opname: string,
  navigateUrl: string,
  timeout = 20000,
): Promise<unknown> {
  // Collect matching responses via event listener (more reliable than waitForResponse
  // which can miss responses during SPA navigation)
  let captured: unknown = null
  const handler = async (resp: PwResponse) => {
    if (captured) return
    const url = resp.url()
    if (url.includes(GRAPHQL_PATH) && url.includes(`opname=${opname}`)) {
      try { captured = await resp.json() } catch { /* ignore parse errors */ }
    }
  }
  page.on('response', handler)

  try {
    await page.goto(navigateUrl, { waitUntil: 'load', timeout: 30_000 })
    // Wait for the GraphQL response to arrive (SPA may fire it after load)
    const deadline = Date.now() + timeout
    while (!captured && Date.now() < deadline) {
      await wait(500)
    }
  } finally {
    page.off('response', handler)
  }

  return captured
}

async function searchProducts(page: Page, params: Record<string, unknown>, errors: Errors) {
  const keyword = String(params.keyword || params.query || params.q || '')
  if (!keyword) throw errors.missingParam('keyword')

  const searchUrl = `${BASE}/s/${encodeURIComponent(keyword)}`
  const result = await interceptGraphQL(page, 'searchModel', searchUrl) as any

  const searchModel = result?.data?.searchModel
  if (!searchModel) return { totalProducts: 0, keyword, products: [] }

  const report = searchModel.searchReport || {}
  const products = (searchModel.products || []).map((p: any) => ({
    itemId: p.identifiers?.itemId || p.itemId || '',
    name: p.identifiers?.productLabel || '',
    brand: p.identifiers?.brandName || '',
    modelNumber: p.identifiers?.modelNumber || '',
    url: p.identifiers?.canonicalUrl ? `${BASE}${p.identifiers.canonicalUrl}` : '',
    price: p.pricing?.value ?? p.pricing?.original ?? null,
    priceDisplay: p.pricing?.alternatePriceDisplay || p.pricing?.message || '',
    rating: p.reviews?.ratingsReviews?.averageRating != null ? Number(p.reviews.ratingsReviews.averageRating) : null,
    reviewCount: Number(p.reviews?.ratingsReviews?.totalReviews) || 0,
    image: p.media?.images?.[0]?.url || '',
    availability: p.availabilityType?.type || '',
    badges: (p.badges || []).map((b: any) => b.label),
    sponsored: p.info?.isSponsored || false,
  }))

  return {
    totalProducts: report.totalProducts || products.length,
    keyword: report.keyword || keyword,
    products,
  }
}

async function getProductDetail(page: Page, params: Record<string, unknown>, errors: Errors) {
  const itemId = String(params.itemId || params.id || '')
  if (!itemId) throw errors.missingParam('itemId')

  // Navigate to product page — use a placeholder slug; HD resolves by itemId
  const productUrl = `${BASE}/p/detail/${itemId}`
  const result = await interceptGraphQL(page, 'productClientOnlyProduct', productUrl) as any

  const product = result?.data?.product
  if (!product) throw errors.fatal(`Product ${itemId} not found`)

  const ids = product.identifiers || {}
  const det = product.details || {}
  const pricing = product.pricing || {}
  const reviews = product.reviews?.ratingsReviews || {}
  const specs = (product.specificationGroup || []).flatMap((g: any) =>
    (g.specifications || []).map((s: any) => ({ group: g.specTitle, name: s.specName, value: s.specValue })),
  )
  const breadcrumbs = (product.taxonomy?.breadCrumbs || []).map((b: any) => b.label)
  const images = (product.media?.images || []).map((i: any) => i.url)

  return {
    itemId: ids.itemId || itemId,
    name: ids.productLabel || '',
    brand: ids.brandName || '',
    modelNumber: ids.modelNumber || '',
    productType: ids.productType || '',
    url: ids.canonicalUrl ? `${BASE}${ids.canonicalUrl}` : '',
    description: det.description || '',
    highlights: det.highlights || [],
    price: pricing.value ?? pricing.original ?? null,
    priceDisplay: pricing.alternatePriceDisplay || pricing.message || '',
    rating: reviews.averageRating != null ? Number(reviews.averageRating) : null,
    reviewCount: Number(reviews.totalReviews) || 0,
    images,
    specifications: specs,
    breadcrumbs,
    availability: product.availabilityType?.type || '',
  }
}

async function getStoreLocator(page: Page, params: Record<string, unknown>, errors: Errors) {
  const zipCode = String(params.zipCode || params.zip || '')
  if (!zipCode) throw errors.missingParam('zipCode')

  // Navigate to store locator results page
  await page.goto(`https://www.homedepot.com/l/search/${encodeURIComponent(zipCode)}`, {
    waitUntil: 'load',
    timeout: 30_000,
  })
  await wait(4000)

  return page.evaluate(`
    (() => {
      const stores = [];
      // Try Apollo cache extraction from window.__APOLLO_STATE__
      // Otherwise fall back to DOM extraction

      // Look for store cards in the DOM
      const cards = document.querySelectorAll('[data-testid*="store"], .store-pod, .storeResult, [class*="storeCard"], [class*="StoreCard"]');

      if (cards.length > 0) {
        cards.forEach(card => {
          const nameEl = card.querySelector('h2, h3, [class*="storeName"], [class*="StoreName"]');
          const addrEl = card.querySelector('[class*="address"], [class*="Address"], address');
          const phoneEl = card.querySelector('[class*="phone"], [class*="Phone"], a[href^="tel:"]');
          const distEl = card.querySelector('[class*="distance"], [class*="Distance"], [class*="miles"]');
          const hoursEl = card.querySelector('[class*="hours"], [class*="Hours"]');
          const storeLink = card.querySelector('a[href*="/l/"]');

          if (nameEl) {
            stores.push({
              name: nameEl.textContent?.trim() || '',
              address: addrEl ? addrEl.textContent?.trim().replace(/\\s+/g, ' ') : '',
              phone: phoneEl ? (phoneEl.getAttribute('href')?.replace('tel:', '') || phoneEl.textContent?.trim()) : '',
              distance: distEl ? distEl.textContent?.trim() : '',
              hours: hoursEl ? hoursEl.textContent?.trim() : '',
              url: storeLink ? 'https://www.homedepot.com' + storeLink.getAttribute('href') : '',
            });
          }
        });
      }

      // Fallback: parse the page for store information blocks
      if (stores.length === 0) {
        const allLinks = [...document.querySelectorAll('a[href*="/l/"][href*="/"]')];
        const storeLinks = allLinks.filter(a => {
          const href = a.getAttribute('href') || '';
          return href.match(/\\/l\\/[A-Za-z]+-[A-Za-z]+/) && !href.includes('/search');
        });

        const seen = new Set();
        for (const link of storeLinks) {
          const href = link.getAttribute('href') || '';
          if (seen.has(href)) continue;
          seen.add(href);
          const text = link.textContent?.trim() || '';
          if (text.length < 3 || text.length > 100) continue;

          // Try to find address info near this link
          const container = link.closest('div, li, article, section') || link.parentElement;
          const containerText = container ? container.textContent?.trim() || '' : '';
          const addrMatch = containerText.match(/(\\d+[^,]+,\\s*[A-Za-z]+,?\\s*[A-Z]{2}\\s*\\d{5})/);
          const phoneMatch = containerText.match(/(\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4})/);

          stores.push({
            name: text.split('\\n')[0].trim(),
            address: addrMatch ? addrMatch[1] : '',
            phone: phoneMatch ? phoneMatch[1] : '',
            distance: '',
            hours: '',
            url: 'https://www.homedepot.com' + href,
          });
        }
      }

      return {
        zipCode: ${JSON.stringify(zipCode)},
        count: stores.length,
        stores,
      };
    })()
  `)
}

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>> = {
  searchProducts,
  getProductDetail,
  getStoreLocator,
}

const adapter = {
  name: 'homedepot-web',
  description: 'Home Depot — product search, detail, store locator via navigation-based GraphQL interception and DOM extraction',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('homedepot.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // No login required for public data
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: { errors: Errors }): Promise<unknown> {
    const { errors } = helpers
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page, { ...params }, errors)
  },
}

export default adapter
