/**
 * Instacart L3 adapter — GraphQL API via persisted queries (GET).
 *
 * Instacart uses Apollo Client persisted queries: all GraphQL requests are GET
 * with operationName, variables, and extensions (sha256Hash) as query params.
 * Full query strings are rejected (PersistedQueryNotSupported).
 *
 * Auth is via cookie_session (credentials: 'include' in browser fetch).
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright-core'

const GRAPHQL_URL = 'https://www.instacart.com/graphql'

/* ---------- persisted query hashes ---------- */

const HASHES: Record<string, string> = {
  CrossRetailerSearchAutosuggestions: '89ec32ea85c9b7ea89f7b4a071a5dd4ec1335831ff67035a0f92376725c306a3',
  Items: '5116339819ff07f207fd38f949a8a7f58e52cc62223b535405b087e3076ebf2f',
  GetProductRatings: 'e0ce69452493f19ece52d62a48a60693831b6ded4fd599633d01ab1d4f88f0b6',
  ProductNutritionalInfo: '9bc43a13c48e633ba4c8016118f101942a44603c5d10f913e9e471ffb730185a',
  GetAccurateRetailerEtas: '382a4e539ffafb2d566b24009cd9bc4b796727b4bb93716a239e349dcc21e864',
  DeliveryHoursInfo: '2b97847310c31a0f645245a08e70fce597a63b04afeb23df39fa654adae453a9',
  DepartmentNavCollections: 'e5231eab24795280ff3e556c24ddfedaed6d9d553a856fa20670428087a21ecb',
  LandingRetailerMetas: 'b8ae98edc10398530e845b5458fed2d63b7024cf3cbd7c0312c9873e494f3d56',
  CollectionProductsWithFeaturedProducts: '5573f6ef85bfad81463b431985396705328c5ac3283c4e183aa36c6aad1afafe',
  RecipesByProductId: '50fda365068f6cfae1bf2905d12a28fb790a69af95b41178742093cc9183d2b5',
}

/* ---------- GraphQL fetch ---------- */

async function graphqlGet(
  page: Page,
  operationName: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const hash = HASHES[operationName]
  if (!hash) throw new Error(`No persisted query hash for: ${operationName}`)

  const params = new URLSearchParams({
    operationName,
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }),
  })

  const url = `${GRAPHQL_URL}?${params.toString()}`

  const result = await page.evaluate(
    async (fetchUrl: string) => {
      const resp = await fetch(fetchUrl, { credentials: 'include' })
      return { status: resp.status, text: await resp.text() }
    },
    url,
  )

  if (result.status >= 400) {
    throw new Error(`GraphQL ${operationName}: HTTP ${result.status}`)
  }

  const json = JSON.parse(result.text) as { data?: unknown; errors?: unknown[] }
  if (json.errors?.length) {
    const msg = (json.errors[0] as Record<string, string>)?.message ?? 'Unknown GraphQL error'
    throw new Error(`GraphQL ${operationName}: ${msg}`)
  }

  return json.data
}

/* ---------- operation handlers ---------- */

async function searchProducts(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
  const limit = Number(params.limit ?? 10)

  const data = (await graphqlGet(page, 'CrossRetailerSearchAutosuggestions', {
    query,
    limit,
    retailerIds: [],
    zoneId: '',
    autosuggestionSessionId: crypto.randomUUID(),
  })) as Record<string, unknown>

  const suggestions = (data.crossRetailerSearchAutosuggestions ?? []) as Array<Record<string, unknown>>

  // Now use the search to get actual product results via page navigation + interception
  const items = await getSearchResults(page, query)

  return {
    suggestions: suggestions.map((s) => ({
      searchTerm: s.searchTerm,
      isNatural: s.isNatural,
    })),
    products: items,
    count: items.length,
  }
}

async function getSearchResults(page: Page, query: string): Promise<unknown[]> {
  const items: unknown[] = []

  const handler = async (response: { url(): string; json(): Promise<unknown> }) => {
    if (response.url().includes('operationName=Items')) {
      try {
        const body = (await response.json()) as { data?: { items?: unknown[] } }
        if (body.data?.items) {
          for (const item of body.data.items) {
            items.push(normalizeItem(item as Record<string, unknown>))
          }
        }
      } catch { /* ignore */ }
    }
  }

  page.on('response', handler)
  try {
    const searchUrl = `https://www.instacart.com/store/s?k=${encodeURIComponent(query)}`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(5000)
  } finally {
    page.off('response', handler)
  }

  return items
}

function normalizeItem(item: Record<string, unknown>): unknown {
  const price = item.price as Record<string, unknown> | undefined
  const priceSection = (price?.viewSection as Record<string, unknown>)
  const itemCard = priceSection?.itemCard as Record<string, unknown> | undefined
  const availability = item.availability as Record<string, unknown> | undefined
  const avSection = availability?.viewSection as Record<string, unknown> | undefined

  return {
    id: item.id,
    productId: item.productId,
    name: item.name,
    size: item.size,
    brandName: item.brandName,
    price: itemCard?.priceString ?? null,
    pricePerUnit: itemCard?.pricePerUnitString ?? null,
    imageUrl: item.evergreenUrl ?? null,
    available: (availability as Record<string, unknown>)?.available ?? null,
    stockLevel: avSection?.stockLevelLabelString ?? null,
  }
}

async function getProductDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const productId = String(params.productId ?? '')
  const retailerSlug = String(params.retailerSlug ?? 'publix')

  // Navigate to product page and intercept responses
  const detail: Record<string, unknown> = {}

  const handler = async (response: { url(): string; json(): Promise<unknown> }) => {
    const url = response.url()
    try {
      if (url.includes('operationName=ItemDetailData')) {
        const body = (await response.json()) as { data?: { itemDetail?: unknown } }
        if (body.data?.itemDetail) detail.itemDetail = body.data.itemDetail
      }
      if (url.includes('operationName=Items') && !detail.items) {
        const body = (await response.json()) as { data?: { items?: unknown[] } }
        if (body.data?.items?.length) {
          detail.items = body.data.items.map((i) => normalizeItem(i as Record<string, unknown>))
        }
      }
    } catch { /* ignore */ }
  }

  page.on('response', handler)
  try {
    const productUrl = `https://www.instacart.com/products/${productId}?retailerSlug=${retailerSlug}`
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(5000)
  } finally {
    page.off('response', handler)
  }

  const product = detail.items ? (detail.items as unknown[])[0] : null
  return { product, detail: detail.itemDetail ?? null }
}

async function getProductRatings(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const productId = String(params.productId ?? '')
  const retailerId = String(params.retailerId ?? '')

  const data = (await graphqlGet(page, 'GetProductRatings', {
    id: productId,
    retailerId,
  })) as Record<string, unknown>

  const ratings = data.productRatings as Record<string, unknown>
  const productRating = ratings?.productRating as Record<string, unknown> | undefined
  const unitRatings = (ratings?.productUnitRatings ?? []) as Array<Record<string, unknown>>

  return {
    averageRating: productRating?.value ? Number(productRating.value) / 20 : null,
    totalRatings: productRating?.amount ?? 0,
    distribution: unitRatings.map((r) => ({
      stars: Math.round(Number(r.value) / 20),
      count: r.amount,
      percent: r.percent,
    })),
  }
}

async function getProductNutrition(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const productId = String(params.productId ?? '')
  const retailerSlug = String(params.retailerSlug ?? 'publix')

  // Navigate to product page to get nutrition in context (direct API returns null without session)
  let info: Record<string, unknown> | undefined

  const handler = async (response: { url(): string; json(): Promise<unknown> }) => {
    if (response.url().includes('operationName=ProductNutritionalInfo') && !info) {
      try {
        const body = (await response.json()) as { data?: { productNutritionalInfo?: { nutritionalInfo?: Record<string, unknown> } } }
        if (body.data?.productNutritionalInfo?.nutritionalInfo) {
          info = body.data.productNutritionalInfo.nutritionalInfo
        }
      } catch { /* ignore */ }
    }
  }

  page.on('response', handler)
  try {
    const productUrl = `https://www.instacart.com/products/${productId}?retailerSlug=${retailerSlug}`
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(5000)
  } finally {
    page.off('response', handler)
  }

  if (!info) return { nutrition: null }

  return {
    nutrition: {
      calories: info.calories,
      fat: info.fat,
      saturatedFat: info.saturatedFat,
      transFat: info.transFat,
      cholesterol: info.cholesterol,
      sodium: info.sodium,
      carbohydrate: info.carbohydrate,
      fiber: info.fiber,
      sugars: info.sugars,
      addedSugars: info.addedSugars,
      protein: info.protein,
      servingSize: info.servingSize,
      servingsPerContainer: info.servingsPerContainer,
    },
  }
}

async function getNearbyStores(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const postalCode = String(params.postalCode ?? '')
  const shopIds = (params.shopIds ?? []) as string[]

  const data = (await graphqlGet(page, 'GetAccurateRetailerEtas', {
    addressId: null,
    homeLoadUuid: '',
    postalCode,
    retailerIds: [],
    serviceType: 'DELIVERY',
    shopIds,
  })) as Record<string, unknown>

  const etas = (data.getAccurateRetailerEtas ?? []) as Array<Record<string, unknown>>

  return {
    stores: etas.map((eta) => {
      const vs = eta.viewSection as Record<string, unknown> | undefined
      return {
        retailerId: eta.retailerId,
        etaMinutes: eta.etaSeconds ? Math.round(Number(eta.etaSeconds) / 60) : null,
        etaDisplay: vs?.homeCondensedEtaString ?? null,
      }
    }),
    count: etas.length,
  }
}

async function getDeliveryWindows(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const shopIds = (params.shopIds ?? []) as string[]
  const startDate = String(params.startDate ?? '')
  const endDate = String(params.endDate ?? '')

  const data = (await graphqlGet(page, 'DeliveryHoursInfo', {
    startDate,
    endDate,
    shopIds,
    retailerLocations: null,
  })) as Record<string, unknown>

  const info = (data.deliveryHoursInfo ?? []) as Array<Record<string, unknown>>

  return {
    retailers: info.map((r) => ({
      retailerId: r.retailerId,
      deliveryHours: ((r.deliveryHours ?? []) as Array<Record<string, unknown>>).map((h) => ({
        date: h.date,
        startHour: h.startHour,
        endHour: h.endHour,
      })),
    })),
  }
}

async function getStoreCategories(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const shopId = String(params.shopId ?? '')
  let token = String(params.retailerInventorySessionToken ?? '')

  // If no token provided, navigate to store page to extract it
  if (!token) {
    const handler = async (response: { url(): string; json(): Promise<unknown> }) => {
      if (response.url().includes('operationName=ShopCollectionScoped') && !token) {
        try {
          const body = (await response.json()) as { data?: { shopCollection?: { shops?: Array<{ retailerInventorySessionToken?: string }> } } }
          const shops = body.data?.shopCollection?.shops
          if (shops?.[0]?.retailerInventorySessionToken) {
            token = shops[0].retailerInventorySessionToken
          }
        } catch { /* ignore */ }
      }
    }

    page.on('response', handler)
    try {
      const retailerSlug = String(params.retailerSlug ?? 'publix')
      await page.goto(`https://www.instacart.com/store/${retailerSlug}/storefront`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(5000)
    } finally {
      page.off('response', handler)
    }
  }

  const data = (await graphqlGet(page, 'DepartmentNavCollections', {
    retailerInventorySessionToken: token,
    includeSlugs: [],
    shopId,
  })) as Record<string, unknown>

  const collections = (data.deptCollections ?? []) as Array<Record<string, unknown>>

  return {
    categories: collections.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parentId: c.parentId,
    })),
    count: collections.length,
  }
}

async function getStoreInfo(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const retailerSlug = String(params.retailerSlug ?? '')
  const retailerId = String(params.retailerId ?? '')
  const zoneId = String(params.zoneId ?? '')

  const data = (await graphqlGet(page, 'LandingRetailerMetas', {
    retailerSlug,
    retailerId,
    zoneId,
    pageType: 'default',
  })) as Record<string, unknown>

  const metas = data.landingRetailerMetas as Record<string, unknown> | undefined
  const vs = metas?.viewSection as Record<string, unknown> | undefined

  return {
    id: metas?.id ?? null,
    title: vs?.titleString ?? null,
    description: vs?.descriptionString ?? null,
    noIndex: metas?.noIndex ?? false,
  }
}

async function getCategoryProducts(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const shopId = String(params.shopId ?? '')
  const slug = String(params.slug ?? '')
  const postalCode = String(params.postalCode ?? '')
  const zoneId = String(params.zoneId ?? '')
  const first = Number(params.first ?? 20)

  const data = (await graphqlGet(page, 'CollectionProductsWithFeaturedProducts', {
    shopId,
    slug,
    filters: [],
    pageViewId: crypto.randomUUID(),
    itemsDisplayType: 'collections_all_items_grid',
    first,
    pageSource: 'collections',
    postalCode,
    zoneId,
  })) as Record<string, unknown>

  const coll = data.collectionProducts as Record<string, unknown> | undefined
  const collection = coll?.collection as Record<string, unknown> | undefined
  const itemIds = (coll?.itemIds ?? []) as string[]

  // Fetch actual item data using Items query
  let products: unknown[] = []
  if (itemIds.length > 0) {
    const itemsData = (await graphqlGet(page, 'Items', {
      ids: itemIds,
      shopId,
      zoneId,
      postalCode,
    })) as Record<string, unknown>

    const items = (itemsData.items ?? []) as Array<Record<string, unknown>>
    products = items.map(normalizeItem)
  }

  return {
    collection: collection ? { id: collection.id, name: collection.name, slug: collection.slug } : null,
    products,
    count: products.length,
    hasMore: coll?.hasMore ?? false,
  }
}

async function getRecipesByProduct(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const productId = String(params.productId ?? '')
  const retailerInventorySessionToken = String(params.retailerInventorySessionToken ?? '')

  const data = (await graphqlGet(page, 'RecipesByProductId', {
    retailerInventorySessionToken,
    productId,
  })) as Record<string, unknown>

  const recipes = (data.recipesByProductId ?? []) as Array<Record<string, unknown>>

  return {
    recipes: recipes.map((r) => ({
      id: r.id,
      name: r.name,
      imageUrl: (r.image as Record<string, string>)?.url ?? null,
    })),
    count: recipes.length,
  }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchProducts,
  getProductDetail,
  getProductRatings,
  getProductNutrition,
  getNearbyStores,
  getDeliveryWindows,
  getStoreCategories,
  getStoreInfo,
  getCategoryProducts,
  getRecipesByProduct,
}

const adapter: CodeAdapter = {
  name: 'instacart-graphql',
  description: 'Instacart GraphQL API — grocery search, product details, pricing, delivery, stores',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('instacart.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://www.instacart.com')
    return cookies.some((c) => c.name === '_instacart_session' || c.name === 'session_token')
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
