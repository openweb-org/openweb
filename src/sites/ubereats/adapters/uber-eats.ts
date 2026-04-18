import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

/**
 * Uber Eats adapter — cart operations via server-side draft order APIs.
 *
 * Transport: Tier 5 (page.evaluate + fetch). Zero DOM selectors.
 *
 * APIs discovered (2026-04-13):
 * - createDraftOrderV2: creates server-side cart with items + customizations
 * - discardDraftOrdersV1: removes entire draft order (clears cart for store)
 * - getDraftOrdersByEaterUuidV1: reads server-side cart state
 * - getStoreV1: validates store, resolves catalog items + sections
 * - getMenuItemV1: resolves customization options for items with hasCustomizations
 */

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
  wrap(error: unknown): Error
}

type Helpers = {
  pageFetch: (page: Page, opts: { url: string; method?: string; body?: string; headers?: Record<string, string>; timeout?: number }) => Promise<{ status: number; text: string }>
  errors: Errors
}

const BASE = 'https://www.ubereats.com'
const API_HEADERS = { 'content-type': 'application/json', 'x-csrf-token': 'x' }

/** Call a UberEats /_p/api/ endpoint via pageFetch. */
async function apiCall(page: Page, helpers: Helpers, endpoint: string, body: unknown): Promise<any> {
  const resp = await helpers.pageFetch(page, {
    url: `${BASE}/_p/api/${endpoint}`,
    method: 'POST',
    headers: API_HEADERS,
    body: JSON.stringify(body),
    timeout: 10_000,
  })
  if (resp.status !== 200) {
    if (resp.status === 401 || resp.status === 403) throw helpers.errors.needsLogin()
    throw helpers.errors.fatal(`${endpoint} returned ${resp.status}`)
  }
  const data = JSON.parse(resp.text)
  if (data.status !== 'success') {
    const msg = data.data?.message || 'unknown error'
    // Eater-scoped endpoints return {status:'failure', data.code:3} or empty {message:""} when the eater session
    // is gone (cookie expiry / region invalidation). Surface as needs_login so refreshProfile + Tier 4 can recover.
    const looksUnauth = data.data?.code === 3 || msg === '' || /unauth|session|status code error/i.test(msg)
    if (looksUnauth) throw helpers.errors.needsLogin()
    throw helpers.errors.fatal(`${endpoint}: ${msg}`)
  }
  return data.data
}

/** Ensure page is on ubereats.com (navigate if needed). */
async function ensureUberEatsPage(page: Page): Promise<void> {
  if (!page.url().includes('ubereats.com')) {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(1500)
  }
}

type CatalogItem = {
  uuid: string
  sectionUuid: string
  subsectionUuid: string
  title: string
  price: number
  hasCustomizations?: boolean
}

/** Find an item in the store catalog. */
function findCatalogItem(catalog: Record<string, unknown[]>, itemUuid: string): CatalogItem | null {
  for (const groups of Object.values(catalog)) {
    for (const group of groups as Array<{ payload?: { standardItemsPayload?: { catalogItems?: CatalogItem[] } } }>) {
      const items = group?.payload?.standardItemsPayload?.catalogItems || []
      const match = items.find(i => i.uuid === itemUuid)
      if (match) return match
    }
  }
  return null
}

async function addToCart(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const { errors } = helpers
  const storeUuid = String(params.storeUuid || '')
  const itemUuid = String(params.itemUuid || '')
  const quantity = Number(params.quantity) || 1
  const customizations = (params.customizations || {}) as Record<string, unknown>

  if (!storeUuid) throw errors.missingParam('storeUuid')
  if (!itemUuid) throw errors.missingParam('itemUuid')

  await ensureUberEatsPage(page)

  // Step 1: Validate store + find item in catalog
  const storeData = await apiCall(page, helpers, 'getStoreV1', { storeUuid })
  if (!storeData.isOpen) throw errors.retriable('Store is currently closed')

  const item = storeData.catalogSectionsMap ? findCatalogItem(storeData.catalogSectionsMap, itemUuid) : null
  if (!item) throw errors.fatal(`Item ${itemUuid} not found in store menu`)

  // Step 2: Create draft order via API
  const draftOrder = await apiCall(page, helpers, 'createDraftOrderV2', {
    isMulticart: true,
    shoppingCartItems: [{
      uuid: itemUuid,
      shoppingCartItemUuid: crypto.randomUUID(),
      storeUuid,
      sectionUuid: item.sectionUuid,
      subsectionUuid: item.subsectionUuid,
      price: item.price,
      title: item.title,
      quantity,
      customizations,
    }],
  })

  // Step 3: Verify via draft orders
  const cartCount = draftOrder.draftOrder?.shoppingCart?.items?.length || 0

  return {
    success: cartCount > 0,
    storeUuid,
    itemUuid,
    quantity,
    cartCount,
  }
}

async function removeFromCart(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const { errors } = helpers
  const itemUuid = String(params.itemUuid || '')

  if (!itemUuid) throw errors.missingParam('itemUuid')

  await ensureUberEatsPage(page)

  // Step 1: Query server-side draft orders to find the item
  const draftData = await apiCall(page, helpers, 'getDraftOrdersByEaterUuidV1', {})
  let draftOrderUUID = ''
  let cartUUID = ''
  let storeUUID = ''
  let shoppingCartItemUUID = ''
  for (const order of draftData.draftOrders || []) {
    for (const item of order.shoppingCart?.items || []) {
      if (item.uuid === itemUuid) {
        draftOrderUUID = order.uuid
        cartUUID = order.shoppingCart.cartUuid
        storeUUID = order.storeUuid
        shoppingCartItemUUID = item.shoppingCartItemUuid
        break
      }
    }
    if (draftOrderUUID) break
  }

  if (!draftOrderUUID) {
    throw errors.retriable('Item not in cart — no draft order contains this item UUID')
  }

  // Step 2: Remove specific item via API (keeps other items in the cart)
  await apiCall(page, helpers, 'removeItemsFromDraftOrderV2', {
    cartUUID,
    draftOrderUUID,
    shoppingCartItemUUIDs: [shoppingCartItemUUID],
    storeUUID,
    locationType: 'DEFAULT',
  })

  // Step 3: Verify removal and count remaining items
  const afterData = await apiCall(page, helpers, 'getDraftOrdersByEaterUuidV1', {})
  let afterCount = 0
  for (const order of afterData.draftOrders || []) {
    afterCount += order.shoppingCart?.items?.length || 0
  }

  return {
    success: true,
    itemUuid,
    cartCount: afterCount,
  }
}

async function emptyCart(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const { errors } = helpers
  const storeUuid = String(params.storeUuid || '')

  await ensureUberEatsPage(page)

  // Step 1: Find draft orders (optionally filtered by store)
  const draftData = await apiCall(page, helpers, 'getDraftOrdersByEaterUuidV1', {})
  const toDiscard: string[] = []
  for (const order of draftData.draftOrders || []) {
    if (!storeUuid || order.storeUuid === storeUuid) {
      toDiscard.push(order.uuid)
    }
  }

  if (toDiscard.length === 0) {
    return { success: true, discarded: 0, cartCount: 0 }
  }

  // Step 2: Discard draft orders
  await apiCall(page, helpers, 'discardDraftOrdersV1', {
    draftOrderUUIDs: toDiscard,
    storeUUID: storeUuid || (draftData.draftOrders[0]?.storeUuid ?? ''),
  })

  // Step 3: Verify
  const afterData = await apiCall(page, helpers, 'getDraftOrdersByEaterUuidV1', {})
  let afterCount = 0
  for (const order of afterData.draftOrders || []) {
    afterCount += order.shoppingCart?.items?.length || 0
  }

  return {
    success: true,
    discarded: toDiscard.length,
    cartCount: afterCount,
  }
}

async function getEatsOrderHistory(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const lastWorkflowUUID = params.lastWorkflowUUID ? String(params.lastWorkflowUUID) : ''

  await ensureUberEatsPage(page)

  const data = await apiCall(page, helpers, 'getPastOrdersV1', { lastWorkflowUUID })

  return {
    ordersMap: data.ordersMap || {},
    orderUuids: data.orderUuids || [],
    paginationData: data.paginationData ?? null,
    meta: data.meta ?? null,
  }
}

async function getCart(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const storeUuid = String(params.storeUuid || '')

  await ensureUberEatsPage(page)

  const draftData = await apiCall(page, helpers, 'getDraftOrdersByEaterUuidV1', {})
  const carts = []
  for (const order of draftData.draftOrders || []) {
    if (storeUuid && order.storeUuid !== storeUuid) continue
    const items = (order.shoppingCart?.items || []).map((item: Record<string, unknown>) => ({
      uuid: item.uuid,
      title: item.title,
      price: item.price,
      quantity: item.quantity,
      shoppingCartItemUuid: item.shoppingCartItemUuid,
    }))
    carts.push({
      storeUuid: order.storeUuid,
      draftOrderUUID: order.uuid,
      cartUUID: order.shoppingCart?.cartUuid,
      itemCount: items.length,
      items,
    })
  }

  return { carts, totalItems: carts.reduce((sum, c) => sum + c.itemCount, 0) }
}

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, helpers: Helpers) => Promise<unknown>> = {
  addToCart,
  removeFromCart,
  emptyCart,
  getCart,
  getEatsOrderHistory,
}

const adapter: CustomRunner = {
  name: 'uber-eats',
  description: 'Uber Eats — cart operations via draft order APIs (Tier 5)',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const h = helpers as unknown as Helpers
    const handler = OPERATIONS[operation]
    if (!handler) throw h.errors.unknownOp(operation)
    try {
      return await handler(page as Page, { ...params }, h)
    } catch (error) {
      throw h.errors.wrap(error)
    }
  },
}

export default adapter
