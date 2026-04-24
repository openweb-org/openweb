import type { Page } from 'patchright'

import type { CustomRunner, AdapterHelpers } from '../../../types/adapter.js'

const BASE = 'https://www.ubereats.com'
const API_HEADERS = { 'content-type': 'application/json', 'x-csrf-token': 'x' }

type R = Record<string, unknown>

async function apiCall(page: Page, helpers: AdapterHelpers, endpoint: string, body: unknown): Promise<any> {
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
    const looksUnauth = data.data?.code === 3 || msg === '' || /unauth|session|status code error/i.test(msg)
    if (looksUnauth) throw helpers.errors.needsLogin()
    throw helpers.errors.fatal(`${endpoint}: ${msg}`)
  }
  return data.data
}

async function ensureUberEatsPage(page: Page): Promise<void> {
  if (!page.url().includes('ubereats.com')) {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(1500)
  }
}

// ── Cart operations ─────────────────────────────────────────────────

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

async function addToCart(page: Page, params: R, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const storeUuid = String(params.storeUuid || '')
  const itemUuid = String(params.itemUuid || '')
  const quantity = Number(params.quantity) || 1
  const customizations = (params.customizations || {}) as R

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

async function removeFromCart(page: Page, params: R, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const itemUuid = String(params.itemUuid || '')

  if (!itemUuid) throw errors.missingParam('itemUuid')

  await ensureUberEatsPage(page)

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

  if (!draftOrderUUID) throw errors.retriable('Item not in cart — no draft order contains this item UUID')

  await apiCall(page, helpers, 'removeItemsFromDraftOrderV2', {
    cartUUID,
    draftOrderUUID,
    shoppingCartItemUUIDs: [shoppingCartItemUUID],
    storeUUID,
    locationType: 'DEFAULT',
  })

  // Verify removal
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

async function emptyCart(page: Page, params: R, helpers: AdapterHelpers): Promise<unknown> {
  const { errors } = helpers
  const storeUuid = String(params.storeUuid || '')

  await ensureUberEatsPage(page)

  // Find draft orders (optionally filtered by store)
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

  // Discard draft orders
  await apiCall(page, helpers, 'discardDraftOrdersV1', {
    draftOrderUUIDs: toDiscard,
    storeUUID: storeUuid || (draftData.draftOrders[0]?.storeUuid ?? ''),
  })

  // Verify
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

async function getEatsOrderHistory(page: Page, params: R, helpers: AdapterHelpers): Promise<unknown> {
  const lastWorkflowUUID = params.lastWorkflowUUID ? String(params.lastWorkflowUUID) : ''

  await ensureUberEatsPage(page)

  const data = await apiCall(page, helpers, 'getPastOrdersV1', { lastWorkflowUUID })

  const ordersMap: R = {}
  for (const [uuid, order] of Object.entries((data.ordersMap || {}) as R)) {
    const o = order as R
    const eo = (o.baseEaterOrder || {}) as R
    const cart = (eo.shoppingCart || {}) as R
    const si = (o.storeInfo || {}) as R
    const fi = (o.fareInfo || {}) as R
    ordersMap[uuid] = {
      baseEaterOrder: {
        uuid: eo.uuid,
        completedAt: eo.completedAt ?? null,
        isCancelled: eo.isCancelled ?? false,
        isCompleted: eo.isCompleted ?? false,
        shoppingCart: {
          items: ((cart.items as R[]) || []).map((item: R) => ({
            title: item.title,
            price: item.price,
            quantity: item.quantity,
          })),
        },
      },
      storeInfo: { title: si.title, uuid: si.uuid },
      fareInfo: { totalPrice: fi.totalPrice ?? null },
    }
  }

  return {
    ordersMap,
    orderUuids: data.orderUuids || [],
    paginationData: data.paginationData ?? null,
    meta: data.meta ?? null,
  }
}

async function getCart(page: Page, params: R, helpers: AdapterHelpers): Promise<unknown> {
  const storeUuid = String(params.storeUuid || '')

  await ensureUberEatsPage(page)

  const draftData = await apiCall(page, helpers, 'getDraftOrdersByEaterUuidV1', {})
  const carts = []
  for (const order of draftData.draftOrders || []) {
    if (storeUuid && order.storeUuid !== storeUuid) continue
    const items = (order.shoppingCart?.items || []).map((item: R) => ({
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

  return { carts, totalItems: carts.reduce((sum: number, c: R) => sum + (c.itemCount as number), 0) }
}

const OPERATIONS: Record<string, (page: Page, params: R, helpers: AdapterHelpers) => Promise<unknown>> = {
  addToCart,
  removeFromCart,
  emptyCart,
  getCart,
  getEatsOrderHistory,
}

const adapter: CustomRunner = {
  name: 'uber-eats',
  description: 'Uber Eats — cart + order history with response trimming (Tier 5)',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('uber-eats adapter requires a browser page')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, { ...params }, helpers)
  },
}

export default adapter
