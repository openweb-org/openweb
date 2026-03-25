/**
 * Costco L3 adapter — POST-based APIs via Playwright request context.
 *
 * Search: POST gdx-api.costco.com/catalog/search/api/v1/search
 * Product: POST ecom-api.costco.com/ebusiness/product/v1/products/graphql
 *
 * PerimeterX intercepts window.fetch/XHR on costco.com, so we use
 * Playwright's page.request API which bypasses page JS interception
 * while inheriting browser cookies.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright'

const SEARCH_URL = 'https://gdx-api.costco.com/catalog/search/api/v1/search'
const PRODUCT_GRAPHQL_URL = 'https://ecom-api.costco.com/ebusiness/product/v1/products/graphql'
const SEARCH_CLIENT_ID = '168287ea-1201-45f6-9b45-5bbea49f8ee7'
const PRODUCT_CLIENT_ID = '4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf'

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
    const text = await resp.text()
    throw new Error(`Costco API ${url}: HTTP ${resp.status()} — ${text.substring(0, 300)}`)
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
  if (!itemNumber) throw new Error('itemNumber is required')

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

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchProducts,
  getProductDetail,
}

const adapter: CodeAdapter = {
  name: 'costco-api',
  description: 'Costco product search and detail — POST-based APIs via Playwright request',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('costco.com')
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) {
      throw new Error(`Unknown operation: ${operation}`)
    }
    return handler(page, { ...params })
  },
}

export default adapter
