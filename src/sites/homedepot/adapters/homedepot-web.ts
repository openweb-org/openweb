import type { Page, Response as PwResponse } from 'patchright'

/**
 * Home Depot L3 adapter — navigation-based GraphQL interception.
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

/** Deeply-nested GraphQL response node — self-referential to allow property chaining. */
interface GqlNode { readonly [key: string]: GqlNode }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BASE = 'https://www.homedepot.com'
const GRAPHQL_PATH = '/federation-gateway/graphql'

/** Intercept a GraphQL response by navigating to a page that triggers it. */
async function interceptGraphQL(
  page: Page,
  opname: string,
  navigateUrl: string,
  options?: { timeout?: number; afterNavigate?: (page: Page) => Promise<void> },
): Promise<unknown> {
  const timeout = options?.timeout ?? 20000
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
    if (options?.afterNavigate) await options.afterNavigate(page)
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
  const result = await interceptGraphQL(page, 'searchModel', searchUrl) as GqlNode

  const searchModel = result?.data?.searchModel
  if (!searchModel) return { totalProducts: 0, keyword, products: [] }

  const report = searchModel.searchReport || {}
  const products = (searchModel.products || []).map((p: GqlNode) => ({
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
    badges: (p.badges || []).map((b: GqlNode) => b.label),
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
  const result = await interceptGraphQL(page, 'productClientOnlyProduct', productUrl) as GqlNode

  const product = result?.data?.product
  if (!product) throw errors.fatal(`Product ${itemId} not found`)

  const ids = product.identifiers || {}
  const det = product.details || {}
  const pricing = product.pricing || {}
  const reviews = product.reviews?.ratingsReviews || {}
  const specs = (product.specificationGroup || []).flatMap((g: GqlNode) =>
    (g.specifications || []).map((s: GqlNode) => ({ group: g.specTitle, name: s.specName, value: s.specValue })),
  )
  const breadcrumbs = (product.taxonomy?.breadCrumbs || []).map((b: GqlNode) => b.label)
  const images = (product.media?.images || []).map((i: GqlNode) => i.url)

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

async function getProductReviews(page: Page, params: Record<string, unknown>, errors: Errors) {
  const itemId = String(params.itemId || params.id || '')
  if (!itemId) throw errors.missingParam('itemId')

  const productUrl = `${BASE}/p/detail/${itemId}`
  const result = await interceptGraphQL(page, 'reviews', productUrl, {
    afterNavigate: async (p) => {
      // Reviews are lazy-loaded on scroll — scroll to the reviews section to trigger the GraphQL call
      await p.evaluate(() => {
        const el = document.querySelector('#product-section-rr')
        if (el) el.scrollIntoView({ behavior: 'instant' })
        else window.scrollTo(0, document.body.scrollHeight * 0.7)
      })
    },
  }) as GqlNode

  const reviewsData = result?.data?.reviews
  if (!reviewsData) return { itemId, totalReviews: 0, reviews: [] }

  const reviews = (reviewsData.Results || []).map((r: GqlNode) => ({
    id: r.Id || '',
    rating: Number(r.Rating) || 0,
    title: r.Title || null,
    text: r.ReviewText || '',
    author: r.UserNickname || '',
    date: r.SubmissionTime || '',
    isRecommended: r.IsRecommended ?? null,
    isSyndicated: r.IsSyndicated || false,
    helpfulVotes: Number(r.TotalPositiveFeedbackCount) || 0,
    unhelpfulVotes: Number(r.TotalNegativeFeedbackCount) || 0,
    photos: (r.Photos || []).map((ph: GqlNode) => ph.Sizes?.normal?.Url || ph.Sizes?.thumbnail?.Url || ''),
    badges: Object.entries(r.Badges || {})
      .filter(([k, v]) => v && k !== '__typename')
      .map(([k]) => k),
    location: r.UserLocation || null,
  }))

  return {
    itemId,
    totalReviews: Number(reviewsData.TotalResults) || reviews.length,
    reviews,
  }
}

async function getProductPricing(page: Page, params: Record<string, unknown>, errors: Errors) {
  const itemId = String(params.itemId || params.id || '')
  if (!itemId) throw errors.missingParam('itemId')

  const productUrl = `${BASE}/p/detail/${itemId}`
  const result = await interceptGraphQL(page, 'productClientOnlyProduct', productUrl) as GqlNode

  const product = result?.data?.product
  if (!product) throw errors.fatal(`Product ${itemId} not found`)

  const pricing = product.pricing || {}
  const promo = pricing.promotion || {}
  const alt = pricing.alternate || {}
  const conditionals = (pricing.conditionalPromotions || []).map((cp: GqlNode) => ({
    type: cp.experienceTag || '',
    subType: cp.subExperienceTag || '',
    description: cp.description?.shortDesc || cp.description?.longDesc || '',
    startDate: cp.dates?.start || null,
    endDate: cp.dates?.end || null,
  }))

  return {
    itemId: product.identifiers?.itemId || itemId,
    name: product.identifiers?.productLabel || '',
    price: pricing.value ?? null,
    originalPrice: pricing.original ?? null,
    unitOfMeasure: pricing.unitOfMeasure || null,
    mapAboveOriginalPrice: pricing.mapAboveOriginalPrice ?? null,
    clearance: pricing.clearance ?? null,
    specialBuy: pricing.specialBuy ?? null,
    promotion: promo.type ? {
      type: promo.type || '',
      description: promo.description || '',
      dollarOff: promo.dollarOff ?? null,
      percentageOff: promo.percentageOff ?? null,
      startDate: promo.dates?.start || null,
      endDate: promo.dates?.end || null,
    } : null,
    unitPricing: alt.unit?.value ? {
      value: alt.unit.value,
      unitOfMeasure: alt.unit.caseUnitOfMeasure || '',
    } : null,
    bulkPricing: alt.bulk ?? null,
    conditionalPromotions: conditionals.length > 0 ? conditionals : null,
  }
}

async function getStoreAvailability(page: Page, params: Record<string, unknown>, errors: Errors) {
  const itemId = String(params.itemId || params.id || '')
  if (!itemId) throw errors.missingParam('itemId')

  const productUrl = `${BASE}/p/detail/${itemId}`
  const result = await interceptGraphQL(page, 'productClientOnlyProduct', productUrl) as GqlNode

  const product = result?.data?.product
  if (!product) throw errors.fatal(`Product ${itemId} not found`)

  const fulfillment = product.fulfillment || {}
  const options = (fulfillment.fulfillmentOptions || []).map((opt: GqlNode) => {
    const services = (opt.services || []).map((svc: GqlNode) => {
      const loc = svc.locations?.[0] || {}
      const inv = loc.inventory || {}
      return {
        type: svc.type || '',
        deliveryTimeline: svc.deliveryTimeline || null,
        startDate: svc.deliveryDates?.startDate || null,
        endDate: svc.deliveryDates?.endDate || null,
        deliveryCharge: svc.totalCharge ?? null,
        hasFreeShipping: svc.hasFreeShipping || false,
        storeId: loc.locationId || null,
        storeName: loc.storeName || null,
        storePhone: loc.storePhone || null,
        inStock: inv.isInStock || false,
        quantity: Number(inv.quantity) || 0,
        isLimitedQuantity: inv.isLimitedQuantity || false,
        curbsidePickup: loc.curbsidePickupFlag || false,
      }
    })
    return { type: opt.type || '', fulfillable: opt.fulfillable || false, services }
  })

  return {
    itemId: product.identifiers?.itemId || itemId,
    name: product.identifiers?.productLabel || '',
    availabilityType: product.availabilityType?.type || '',
    discontinued: product.availabilityType?.discontinued || false,
    buyable: product.availabilityType?.buyable ?? true,
    fulfillmentOptions: options,
  }
}

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>> = {
  searchProducts,
  getProductDetail,
  getProductReviews,
  getProductPricing,
  getStoreAvailability,
}

const adapter = {
  name: 'homedepot-web',
  description: 'Home Depot — search, detail, reviews, pricing, and store availability via GraphQL interception',

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
