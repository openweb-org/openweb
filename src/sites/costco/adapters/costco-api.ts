import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
/**
 * Costco L3 adapter — POST-based APIs via Playwright request context.
 *
 * Search: POST gdx-api.costco.com/catalog/search/api/v1/search
 * Product: POST ecom-api.costco.com/ebusiness/product/v1/products/graphql
 * Reviews: GET apps.bazaarvoice.com/.../reviews.json (BazaarVoice)
 * Warehouses: GET ecom-api.costco.com/core/warehouse-locator/v1/salesLocations.json
 * Cart: POST www.costco.com/AjaxManageShoppingCartCmd (requires auth)
 *
 * PerimeterX intercepts window.fetch/XHR on costco.com, so we use
 * Playwright's page.request API which bypasses page JS interception
 * while inheriting browser cookies.
 */
import type { CodeAdapter } from '../../../types/adapter.js'

const SEARCH_URL = 'https://gdx-api.costco.com/catalog/search/api/v1/search'
const PRODUCT_GRAPHQL_URL = 'https://ecom-api.costco.com/ebusiness/product/v1/products/graphql'
const WAREHOUSE_LOCATOR_URL = 'https://ecom-api.costco.com/core/warehouse-locator/v1/salesLocations.json'
const ADD_TO_CART_URL = 'https://www.costco.com/AjaxManageShoppingCartCmd'
const SEARCH_CLIENT_ID = '168287ea-1201-45f6-9b45-5bbea49f8ee7'
const PRODUCT_CLIENT_ID = '4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf'
const WAREHOUSE_CLIENT_ID = '7c71124c-7bf1-44db-bc9d-498584cd66e5'

/* ---------- product GraphQL query ---------- */

const PRODUCT_QUERY = `query {
  products(
    itemNumbers: [ITEM_NUMBERS],
    clientId: "${PRODUCT_CLIENT_ID}",
    locale: "en-us",
    warehouseNumber: "847"
  ) {
    catalogData {
      itemNumber
      itemId
      published
      buyable
      programTypes
      priceData { price listPrice }
      attributes { key value type }
      description {
        shortDescription
        longDescription
        marketingStatement
        promotionalStatement
      }
      additionalFieldData {
        rating
        numberOfRating
        eligibleForReviews
        membershipReqd
        maxItemOrderQty
      }
      fieldData { mfPartNumber mfName }
    }
  }
}`

/* ---------- helpers ---------- */

async function getJson(
  page: Page,
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  const resp = await page.request.fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Origin: 'https://www.costco.com',
      Referer: 'https://www.costco.com/',
      ...extraHeaders,
    },
  })

  if (!resp.ok()) {
    throw OpenWebError.httpError(resp.status())
  }

  return resp.json()
}

async function postJson(
  page: Page,
  url: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  const resp = await page.request.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: '*/*',
      Origin: 'https://www.costco.com',
      Referer: 'https://www.costco.com/',
      ...extraHeaders,
    },
    data: JSON.stringify(body as Record<string, unknown>),
  })

  if (!resp.ok()) {
    throw OpenWebError.httpError(resp.status())
  }

  return resp.json()
}

/* ---------- operation handlers ---------- */

async function searchProducts(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
  const pageSize = Number(params.pageSize ?? 24)
  const offset = Number(params.offset ?? 0)

  const body = {
    visitorId: '0',
    query,
    pageSize,
    offset,
    orderBy: null,
    searchMode: 'page',
    personalizationEnabled: false,
    warehouseId: '249-wh',
    shipToPostal: '95050',
    shipToState: 'CA',
    deliveryLocations: [
      '653-bd', '848-bd', '249-wh', '847_0-wm',
    ],
    filterBy: [],
    pageCategories: [],
    userInfo: { userId: '0' },
  }

  const resp = (await postJson(page, SEARCH_URL, body, {
    'client-identifier': SEARCH_CLIENT_ID,
    client_id: 'USBC',
    locale: 'en-US',
    searchresultprovider: 'GRS',
  })) as Record<string, unknown>

  const searchResult = resp.searchResult as Record<string, unknown>
  const results = (searchResult?.results ?? []) as Array<Record<string, unknown>>

  const products = results.map((r) => {
    const product = r.product as Record<string, unknown>
    const attrs = (product?.attributes ?? {}) as Record<string, Record<string, unknown>>
    const primaryImage = (attrs.primary_image?.text as string[])?.[0] ?? null
    const pills = (attrs.pills?.text as string[]) ?? []
    const marketingStatement = (attrs.marketing_statement?.text as string[])?.[0] ?? null

    return {
      itemNumber: r.id,
      title: product?.title,
      brands: product?.brands,
      categories: product?.categories,
      imageUrl: primaryImage,
      pills,
      marketingStatement,
    }
  })

  return {
    query,
    totalCount: searchResult?.totalCount ?? results.length,
    products,
  }
}

async function getProductDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const itemNumber = String(params.itemNumber ?? params.item_number ?? '')
  if (!itemNumber) throw OpenWebError.missingParam('itemNumber')

  const query = PRODUCT_QUERY.replace('ITEM_NUMBERS', `"${itemNumber}"`)
  const resp = (await postJson(page, PRODUCT_GRAPHQL_URL, { query }, {
    'client-identifier': PRODUCT_CLIENT_ID,
    'costco.env': 'ecom',
    'costco.service': 'restProduct',
  })) as Record<string, unknown>

  const data = resp.data as Record<string, unknown>
  const products = data?.products as Record<string, unknown>
  const catalogData = (products?.catalogData as Array<Record<string, unknown>>) ?? []

  if (catalogData.length === 0) {
    return { product: null }
  }

  const item = catalogData[0]
  const attrs = (item.attributes as Array<Record<string, unknown>>) ?? []
  const desc = (item.description as Record<string, string>) ?? {}
  const priceData = (item.priceData as Record<string, string>) ?? {}
  const additionalData = (item.additionalFieldData as Record<string, unknown>) ?? {}
  const fieldData = (item.fieldData as Record<string, unknown>) ?? {}

  const attributes: Record<string, string[]> = {}
  for (const attr of attrs) {
    const key = String(attr.key)
    const value = String(attr.value)
    if (!attributes[key]) attributes[key] = []
    attributes[key].push(value)
  }

  return {
    product: {
      itemNumber: item.itemNumber,
      title: desc.shortDescription ?? null,
      longDescription: desc.longDescription ?? null,
      price: priceData.price ? Number.parseFloat(priceData.price) : null,
      listPrice: priceData.listPrice && priceData.listPrice !== '-1.00000'
        ? Number.parseFloat(priceData.listPrice)
        : null,
      marketingStatement: desc.marketingStatement ?? null,
      promotionalStatement: desc.promotionalStatement ?? null,
      brand: attributes.Brand?.[0] ?? (fieldData.mfName !== 'DO NOT DELETE' ? fieldData.mfName : null) ?? null,
      rating: additionalData.rating != null ? Number(additionalData.rating) : null,
      numberOfRatings: additionalData.numberOfRating != null ? Number(additionalData.numberOfRating) : null,
      buyable: item.buyable === 1,
      attributes,
    },
  }
}

/* ---------- reviews ---------- */

async function getProductReviews(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const productId = String(params.productId ?? params.itemNumber ?? '')
  if (!productId) throw OpenWebError.missingParam('productId')

  // Navigate to product page to trigger BV widget initialization
  const productUrl = `https://www.costco.com/p/-/${productId}?langId=-1`
  await page.goto(productUrl, { waitUntil: 'domcontentloaded' })

  // Wait for BV rating_summary to populate (polls every 500ms, max 10s)
  const bvData = await page.evaluate(async (pid: string) => {
    const maxWait = 10000
    const interval = 500
    let waited = 0
    while (waited < maxWait) {
      const bv = (window as Record<string, unknown>).BV as Record<string, unknown> | undefined
      const rs = bv?.rating_summary as Record<string, unknown> | undefined
      const apiData = rs?.apiData as Record<string, Record<string, unknown>> | undefined
      if (apiData?.[pid]) {
        const summary = apiData[pid]
        return JSON.stringify(summary)
      }
      await new Promise((r) => setTimeout(r, interval))
      waited += interval
    }
    return null
  }, productId)

  if (!bvData) {
    // Fallback: get basic rating from GraphQL
    const query = PRODUCT_QUERY.replace('ITEM_NUMBERS', `"${productId}"`)
    const resp = (await postJson(page, PRODUCT_GRAPHQL_URL, { query }, {
      'client-identifier': PRODUCT_CLIENT_ID,
      'costco.env': 'ecom',
      'costco.service': 'restProduct',
    })) as Record<string, unknown>
    const data = resp.data as Record<string, unknown>
    const products = data?.products as Record<string, unknown>
    const catalogData = (products?.catalogData as Array<Record<string, unknown>>) ?? []
    const item = catalogData[0]
    const addl = (item?.additionalFieldData as Record<string, unknown>) ?? {}
    return {
      productId,
      totalReviews: addl.numberOfRating != null ? Number(addl.numberOfRating) : 0,
      averageRating: addl.rating != null ? Number(addl.rating) : null,
      ratingDistribution: null,
      recommendedPercentage: null,
      reviews: [],
    }
  }

  const summary = JSON.parse(bvData) as Record<string, unknown>
  const reviewSummary = (summary.reviewSummary ?? {}) as Record<string, unknown>
  const primaryRating = (reviewSummary.primaryRating ?? {}) as Record<string, unknown>
  const recommended = (reviewSummary.recommended ?? {}) as Record<string, unknown>
  const recDist = (recommended.distribution ?? []) as Array<Record<string, unknown>>

  const yesCount = recDist.find((d) => d.key === true)?.count as number ?? 0
  const totalRec = recDist.reduce((sum, d) => sum + (d.count as number), 0)

  return {
    productId,
    totalReviews: reviewSummary.numReviews ?? 0,
    averageRating: primaryRating.average ?? null,
    ratingDistribution: primaryRating.distribution ?? null,
    recommendedPercentage: totalRec > 0 ? Math.round((yesCount / totalRec) * 100) : null,
    reviews: [],
  }
}

/* ---------- warehouse locator ---------- */

async function findWarehouses(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const latitude = params.latitude != null ? Number(params.latitude) : null
  const longitude = params.longitude != null ? Number(params.longitude) : null

  if (latitude == null || longitude == null) {
    throw OpenWebError.missingParam('latitude and longitude')
  }

  const limit = Number(params.limit ?? 10)

  const url = `${WAREHOUSE_LOCATOR_URL}?latitude=${latitude}&longitude=${longitude}&limit=${limit}`
  const resp = (await getJson(page, url, {
    'client-identifier': WAREHOUSE_CLIENT_ID,
    'Accept-Language': 'en-us',
  })) as Record<string, unknown>

  const salesLocations = (resp.salesLocations ?? []) as Array<Record<string, unknown>>

  const warehouses = salesLocations.map((w) => {
    const address = (w.address as Record<string, unknown>) ?? {}
    const names = (w.name as Array<Record<string, string>>) ?? []
    const name = names.find((n) => n.localeCode === 'en-US')?.value ?? names[0]?.value ?? null

    // Format hours entries into readable strings
    const formatHours = (entries: Array<Record<string, unknown>>): string | null => {
      if (!entries?.length) return null
      return entries
        .filter((h) => {
          const type = (h.hoursType as Record<string, unknown>)?.code
          return type === 'open'
        })
        .map((h) => {
          const titles = (h.title as Array<Record<string, string>>) ?? []
          const label = titles.find((t) => t.localeCode === 'en-US')?.value ?? ''
          return `${label}: ${h.open} - ${h.close}`
        }).join('; ') || null
    }

    // Warehouse-level hours
    const warehouseHours = formatHours((w.hours as Array<Record<string, unknown>>) ?? [])

    // Service-level hours and service names
    const svcs = (w.services as Array<Record<string, unknown>>) ?? []
    const serviceMap: Record<string, string | null> = {}
    const serviceNames: string[] = []
    for (const svc of svcs) {
      const svcNames = (svc.name as Array<Record<string, string>>) ?? []
      const svcName = svcNames.find((n) => n.localeCode === 'en-US')?.value ?? ''
      serviceNames.push(svcName)
      const svcHours = formatHours((svc.hours as Array<Record<string, unknown>>) ?? [])
      if (svcHours) serviceMap[String(svc.code)] = svcHours
    }

    return {
      warehouseId: w.salesLocationId ?? null,
      name,
      phone: w.phone ?? null,
      address: {
        street: address.line1 ?? null,
        city: address.city ?? null,
        state: address.territory ?? null,
        zipCode: address.postalCode ?? null,
        country: address.countryName ?? null,
      },
      latitude: address.latitude ?? null,
      longitude: address.longitude ?? null,
      distance: w.distance ?? null,
      hours: {
        warehouse: warehouseHours,
        pharmacy: serviceMap.pharmacy ?? null,
        gasStation: serviceMap.gas ?? null,
        tireCenter: serviceMap.auto ?? null,
      },
      services: serviceNames,
    }
  })

  return { warehouses, totalCount: warehouses.length }
}

/* ---------- add to cart ---------- */

async function addToCart(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const itemNumber = String(params.itemNumber ?? params.partNumber ?? '')
  if (!itemNumber) throw OpenWebError.missingParam('itemNumber')
  const quantity = Number(params.quantity ?? 1)

  const qs = new URLSearchParams({
    ajaxFlag: 'true',
    checkOmsInventory: 'true',
    isPdpPage: 'true',
    isRestrictedPostalCode: 'false',
    partNumber: itemNumber,
    actionType: 'add',
    quantity: String(quantity),
    isShipRestrictionStore: 'true',
    productPartnumber: itemNumber,
    isFsaChdItem: 'false',
  })

  const url = `${ADD_TO_CART_URL}?${qs.toString()}`

  const resp = await page.request.fetch(url, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      Referer: 'https://www.costco.com/',
      'Content-Type': 'text/plain;charset=UTF-8',
    },
  })

  if (!resp.ok()) {
    throw OpenWebError.httpError(resp.status())
  }

  const text = await resp.text()
  try {
    return JSON.parse(text)
  } catch {
    return { success: resp.ok(), body: text.substring(0, 500) }
  }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchProducts,
  getProductDetail,
  getProductReviews,
  findWarehouses,
  addToCart,
}

const adapter: CodeAdapter = {
  name: 'costco-api',
  description: 'Costco product search, detail, reviews, warehouse locator, and cart — via Playwright request',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('costco.com')
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) {
        throw OpenWebError.unknownOp(operation)
      }
      return await handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
