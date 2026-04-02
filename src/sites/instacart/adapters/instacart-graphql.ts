import type { Page } from 'playwright-core'
import type { CodeAdapter } from '../../../types/adapter.js'
import { graphqlGet, normalizeItem } from './queries.js'

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

  // Navigate to search results page to trigger Items query via response interception
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
      } catch { /* ignore parse errors from non-JSON responses */ }
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

  return {
    suggestions: suggestions.map((s) => ({
      searchTerm: s.searchTerm,
      isNatural: s.isNatural,
    })),
    products: items,
    count: items.length,
  }
}

async function getStoreProducts(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const retailerSlug = String(params.retailerSlug ?? '')
  const slug = String(params.slug ?? '')
  const first = Number(params.first ?? 20)

  // Navigate to store page to get shopId and session token
  let shopId = String(params.shopId ?? '')
  let zoneId = ''
  let postalCode = ''
  let token = ''

  if (!shopId) {
    const storeHandler = async (response: { url(): string; json(): Promise<unknown> }) => {
      if (response.url().includes('operationName=ShopCollectionScoped') && !shopId) {
        try {
          const body = (await response.json()) as {
            data?: { shopCollection?: { shops?: Array<{ shopId?: string; retailerInventorySessionToken?: string; zoneId?: string; postalCode?: string }> } }
          }
          const shops = body.data?.shopCollection?.shops
          if (shops?.[0]) {
            shopId = shops[0].shopId ?? ''
            token = shops[0].retailerInventorySessionToken ?? ''
          }
        } catch { /* ignore */ }
      }
    }

    page.on('response', storeHandler)
    try {
      await page.goto(`https://www.instacart.com/store/${retailerSlug}/storefront`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      }).catch(() => {})
      await page.waitForTimeout(5000)
    } finally {
      page.off('response', storeHandler)
    }
  }

  // Extract zone and postal from page context
  const geoInfo = await page.evaluate(() => {
    try {
      const stateEl = document.querySelector('script#node-state')
      if (stateEl?.textContent) {
        const state = JSON.parse(stateEl.textContent)
        return { zoneId: state.zoneId || '', postalCode: state.postalCode || '' }
      }
    } catch { /* ignore */ }
    return { zoneId: '', postalCode: '' }
  })
  zoneId = geoInfo.zoneId || '714'
  postalCode = geoInfo.postalCode || ''

  // Fetch collection products
  const data = (await graphqlGet(page, 'CollectionProductsWithFeaturedProducts', {
    shopId,
    slug: slug || 'produce',
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

  let products: unknown[] = []
  if (itemIds.length > 0) {
    const itemsData = (await graphqlGet(page, 'Items', {
      ids: itemIds.slice(0, first),
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

async function getNearbyStores(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const postalCode = String(params.postalCode ?? '')
  const shopIds = (params.shopIds ?? []) as string[]

  // If shopIds provided, call GetAccurateRetailerEtas directly
  if (shopIds.length > 0) {
    const data = (await graphqlGet(page, 'GetAccurateRetailerEtas', {
      addressId: null,
      homeLoadUuid: '',
      postalCode,
      retailerIds: [],
      serviceType: 'DELIVERY',
      shopIds,
    })) as Record<string, unknown>

    const etas = (data.getAccurateRetailerEtas ?? []) as Array<Record<string, unknown>>
    return formatEtas(etas)
  }

  // No shopIds — navigate to store directory and intercept the ETA response
  const etas: Array<Record<string, unknown>> = []
  const handler = async (response: { url(): string; json(): Promise<unknown> }) => {
    if (response.url().includes('operationName=GetAccurateRetailerEtas') && etas.length === 0) {
      try {
        const body = (await response.json()) as {
          data?: { getAccurateRetailerEtas?: Array<Record<string, unknown>> }
        }
        if (body.data?.getAccurateRetailerEtas?.length) {
          etas.push(...body.data.getAccurateRetailerEtas)
        }
      } catch { /* ignore */ }
    }
  }

  page.on('response', handler)
  try {
    // Navigate to a different page first to force fresh load
    if (page.url().includes('instacart.com/store/directory')) {
      await page.goto('https://www.instacart.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(2000)
    }
    await page.goto('https://www.instacart.com/store/directory?filter=all', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    }).catch(() => {})
    await page.waitForTimeout(6000)
  } finally {
    page.off('response', handler)
  }

  return formatEtas(etas)
}

function formatEtas(etas: Array<Record<string, unknown>>) {
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

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchProducts,
  getStoreProducts,
  getNearbyStores,
}

const adapter: CodeAdapter = {
  name: 'instacart-graphql',
  description: 'Instacart GraphQL API — grocery search, store products, nearby stores with delivery ETAs',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('instacart.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // guest access — read ops work without login
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) {
      throw Object.assign(new Error(`Unknown operation: ${operation}`), { failureClass: 'fatal' })
    }
    return handler(page, { ...params })
  },
}

export default adapter
