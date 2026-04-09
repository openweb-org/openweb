import type { Page } from 'patchright'

/**
 * Uber Eats adapter — add-to-cart via browser navigation + click.
 *
 * UberEats manages cart state client-side (localStorage). There is no server
 * API for adding items. This adapter navigates to the store page, opens the
 * item quickView modal, and clicks "Add to order".
 */

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
}

type Helpers = {
  pageFetch: (page: Page, opts: { url: string; method?: string; body?: string; headers?: Record<string, string>; timeout?: number }) => Promise<{ status: number; text: string }>
  errors: Errors
}

const BASE = 'https://www.ubereats.com'

/** Convert full UUID to base64url slug used in UberEats URLs. */
function uuidToSlug(uuid: string): string {
  const hex = uuid.replace(/-/g, '')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  const b64 = Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function addToCart(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const { errors } = helpers
  const storeUuid = String(params.storeUuid || '')
  const itemUuid = String(params.itemUuid || '')
  const quantity = Number(params.quantity) || 1

  if (!storeUuid) throw errors.missingParam('storeUuid')
  if (!itemUuid) throw errors.missingParam('itemUuid')

  // First get the store slug from getStoreV1 to build navigation URL
  const storeResp = await helpers.pageFetch(page, {
    url: `${BASE}/_p/api/getStoreV1`,
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': 'x' },
    body: JSON.stringify({ storeUuid }),
  })

  if (storeResp.status !== 200) {
    throw errors.fatal(`getStoreV1 returned ${storeResp.status}`)
  }

  const storeData = JSON.parse(storeResp.text)
  const slug = storeData.data?.slug || ''
  if (!slug) throw errors.fatal('Could not resolve store slug')

  const storeSlug = uuidToSlug(storeUuid)

  // Find the item's section and subsection UUIDs from the menu
  let sectionUuid = ''
  let subsectionUuid = ''
  const catalog = storeData.data?.catalogSectionsMap
  if (catalog) {
    for (const [, groups] of Object.entries(catalog)) {
      if (sectionUuid) break
      for (const group of groups as Array<{ payload?: { standardItemsPayload?: { catalogItems?: Array<{ uuid: string; sectionUuid: string; subsectionUuid: string }> } } }>) {
        const items = group?.payload?.standardItemsPayload?.catalogItems || []
        const match = items.find(i => i.uuid === itemUuid)
        if (match) {
          sectionUuid = match.sectionUuid || ''
          subsectionUuid = match.subsectionUuid || ''
          break
        }
      }
    }
  }

  // Build quickView URL to open the item modal directly
  const modctx = encodeURIComponent(JSON.stringify({
    storeUuid,
    sectionUuid,
    subsectionUuid,
    itemUuid,
  }))
  const quickViewUrl = `${BASE}/store/${slug}/${storeSlug}?mod=quickView&modctx=${encodeURIComponent(modctx)}`

  // Navigate to store with quickView modal
  await page.goto(quickViewUrl, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(3000)

  // Wait for add-to-cart button
  const addBtn = page.locator('[data-testid="add-to-cart-button"]')
  try {
    await addBtn.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    throw errors.retriable('Add to cart button not found — item modal may not have loaded')
  }

  // Set quantity if > 1
  if (quantity > 1) {
    const increaseBtn = page.locator('[data-testid="quantity-selector-increase"]')
    for (let i = 1; i < quantity; i++) {
      try { await increaseBtn.click({ timeout: 2000 }) } catch { break }
      await page.waitForTimeout(300)
    }
  }

  // Click add to cart
  await addBtn.click({ timeout: 5000 })
  await page.waitForTimeout(3000)

  // Check if cart badge updated
  const badgeText = await page.evaluate(() => {
    const badge = document.querySelector('[data-testid="view-carts-badge"]')
    return badge?.textContent || '0'
  })

  const cartCount = Number.parseInt(badgeText, 10) || 0

  return {
    success: cartCount > 0,
    storeUuid,
    itemUuid,
    quantity,
    cartCount,
  }
}

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, helpers: Helpers) => Promise<unknown>> = {
  addToCart,
}

const adapter = {
  name: 'uber-eats',
  description: 'Uber Eats — add items to cart via browser interaction',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('ubereats.com')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: Helpers): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, { ...params }, helpers)
  },
}

export default adapter
