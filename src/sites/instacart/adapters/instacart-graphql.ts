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
import { graphqlGet, normalizeItem, getSearchResults } from './queries.js'

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
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}) // intentional: best-effort navigation
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
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}) // intentional: best-effort navigation
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
      await page.goto(`https://www.instacart.com/store/${retailerSlug}/storefront`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}) // intentional: best-effort navigation
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
