import type { Page } from 'playwright-core'

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

const GRAPHQL_URL = '/federation-gateway/graphql'

const SEARCH_QUERY = `query searchModel($keyword: String, $storeId: String, $storefilter: StoreFilter, $startIndex: Int, $pageSize: Int, $orderBy: ProductSort, $filter: ProductFilter, $channel: Channel, $navParam: String) {
  searchModel(keyword: $keyword, storeId: $storeId, storefilter: $storefilter, channel: $channel, navParam: $navParam) {
    id
    searchReport { totalProducts keyword }
    products(startIndex: $startIndex, pageSize: $pageSize, orderBy: $orderBy, filter: $filter) {
      itemId
      dataSources
      identifiers { productLabel canonicalUrl brandName itemId modelNumber productType storeSkuNumber }
      media { images { url sizes } }
      pricing { original value alternatePriceDisplay message }
      reviews { ratingsReviews { averageRating totalReviews } }
      availabilityType { type }
      badges { label }
      info { isSponsored }
      fulfillment { fulfillmentOptions { type services { type hasFreeShipping } } }
    }
  }
}`

const PRODUCT_QUERY = `query productClientOnlyProduct($itemId: String!, $storeId: String, $zipCode: String) {
  product(itemId: $itemId) {
    itemId
    dataSources
    identifiers { productLabel canonicalUrl brandName itemId modelNumber productType storeSkuNumber }
    details { collection description descriptiveAttributes { name value } highlights }
    media { images { url sizes type subType } }
    pricing { original value alternatePriceDisplay message }
    reviews { ratingsReviews { averageRating totalReviews } }
    specificationGroup { specTitle specifications { specName specValue } }
    availabilityType { type }
    fulfillment(storeId: $storeId, zipCode: $zipCode) { fulfillmentOptions { type services { type hasFreeShipping deliveryTimeline } } }
    taxonomy { breadCrumbs { label url } }
  }
}`

async function graphqlFetch(
  page: Page,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const url = `${GRAPHQL_URL}?opname=${operationName}`
  const body = JSON.stringify({ operationName, variables, query })

  const result = await page.evaluate(`
    (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        const r = await fetch(${JSON.stringify(url)}, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'x-experience-name': 'general-merchandise',
            'x-debug': 'false',
            'x-current-url': window.location.pathname,
          },
          body: ${JSON.stringify(body)},
          credentials: 'same-origin',
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!r.ok) return { __error: true, status: r.status, text: await r.text() };
        return await r.json();
      } catch (e) {
        clearTimeout(timer);
        return { __error: true, message: e.message };
      }
    })()
  `)

  if (result && typeof result === 'object' && '__error' in result) {
    const msg = (result as any).message || `HTTP ${(result as any).status}`
    throw Object.assign(new Error(`GraphQL ${operationName} failed: ${msg}`), { failureClass: 'retriable' })
  }
  return result
}

async function searchProducts(page: Page, params: Record<string, unknown>) {
  const keyword = String(params.keyword || params.query || params.q || '')
  if (!keyword) throw validationError('keyword is required')
  const pageSize = Number(params.pageSize) || 24
  const startIndex = Number(params.startIndex) || 0

  // Navigate to HD homepage for cookie/session warm-up
  if (!page.url().includes('homedepot.com')) {
    await page.goto('https://www.homedepot.com', { waitUntil: 'load', timeout: 30_000 })
    await wait(3000)
  }

  const variables: Record<string, unknown> = {
    keyword,
    storefilter: 'ALL',
    channel: 'DESKTOP',
    startIndex,
    pageSize,
  }

  const result = await graphqlFetch(page, 'searchModel', SEARCH_QUERY, variables) as any
  const searchModel = result?.data?.searchModel
  if (!searchModel) return { totalProducts: 0, keyword, products: [] }

  const report = searchModel.searchReport || {}
  const products = (searchModel.products || []).map((p: any) => ({
    itemId: p.identifiers?.itemId || p.itemId || '',
    name: p.identifiers?.productLabel || '',
    brand: p.identifiers?.brandName || '',
    modelNumber: p.identifiers?.modelNumber || '',
    url: p.identifiers?.canonicalUrl ? `https://www.homedepot.com${p.identifiers.canonicalUrl}` : '',
    price: p.pricing?.value ?? p.pricing?.original ?? null,
    priceDisplay: p.pricing?.alternatePriceDisplay || p.pricing?.message || '',
    rating: p.reviews?.ratingsReviews?.averageRating ?? null,
    reviewCount: p.reviews?.ratingsReviews?.totalReviews ?? 0,
    image: p.media?.images?.[0]?.url || '',
    availability: p.availabilityType?.type || '',
    badges: (p.badges || []).map((b: any) => b.label),
    sponsored: p.info?.isSponsored || false,
  }))

  return {
    totalProducts: report.totalProducts || products.length,
    keyword: report.keyword || keyword,
    startIndex,
    pageSize,
    products,
  }
}

async function getProductDetail(page: Page, params: Record<string, unknown>) {
  const itemId = String(params.itemId || params.id || '')
  if (!itemId) throw validationError('itemId is required (e.g. "314138390")')

  if (!page.url().includes('homedepot.com')) {
    await page.goto('https://www.homedepot.com', { waitUntil: 'load', timeout: 30_000 })
    await wait(3000)
  }

  const variables: Record<string, unknown> = { itemId }
  if (params.storeId) variables.storeId = String(params.storeId)
  if (params.zipCode) variables.zipCode = String(params.zipCode)

  const result = await graphqlFetch(page, 'productClientOnlyProduct', PRODUCT_QUERY, variables) as any
  const product = result?.data?.product
  if (!product) throw Object.assign(new Error(`Product ${itemId} not found`), { failureClass: 'fatal' })

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
    url: ids.canonicalUrl ? `https://www.homedepot.com${ids.canonicalUrl}` : '',
    description: det.description || '',
    highlights: det.highlights || [],
    price: pricing.value ?? pricing.original ?? null,
    priceDisplay: pricing.alternatePriceDisplay || pricing.message || '',
    rating: reviews.averageRating ?? null,
    reviewCount: reviews.totalReviews ?? 0,
    images,
    specifications: specs,
    breadcrumbs,
    availability: product.availabilityType?.type || '',
  }
}

async function getStoreLocator(page: Page, params: Record<string, unknown>) {
  const zipCode = String(params.zipCode || params.zip || '')
  if (!zipCode) throw validationError('zipCode is required (e.g. "10001")')

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

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchProducts,
  getProductDetail,
  getStoreLocator,
}

const adapter: CodeAdapter = {
  name: 'homedepot-web',
  description: 'Home Depot — product search, detail, store locator via GraphQL API and DOM extraction',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('homedepot.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // No login required for public data
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) throw unknownOpError(operation)
    return handler(page, { ...params })
  },
}

export default adapter
