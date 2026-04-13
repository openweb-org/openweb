import type { Page } from 'patchright'

/**
 * Uber Eats adapter — cart operations via API validation + minimal DOM clicks.
 *
 * Probe findings (2026-04-11):
 * - Cart state is managed client-side in React state (NOT localStorage, NOT server)
 * - No server-side cart mutation API exists (verified via network capture + 35+ endpoint probes)
 * - fetch is NOT patched (native), no webpack chunks, no SSR globals
 * - Stable selectors: data-testid="add-to-cart-button", data-testid="quick-add-button"
 * - Cart does NOT persist across page sessions — each exec gets a fresh page
 *
 * Architecture: API calls for validation, minimal DOM for unavoidable cart mutations.
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
const API_HEADERS = { 'content-type': 'application/json', 'x-csrf-token': 'x' }

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
    throw helpers.errors.fatal(`${endpoint} returned ${resp.status}`)
  }
  const data = JSON.parse(resp.text)
  if (data.status !== 'success') {
    throw helpers.errors.fatal(`${endpoint}: ${data.data?.message || 'unknown error'}`)
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

/** Read cart badge count from DOM. */
async function readCartBadge(page: Page): Promise<number> {
  const text = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="view-carts-badge"]')
    if (!el) return '0'
    const match = el.textContent?.match(/\d+/)
    return match ? match[0] : '0'
  })
  return Number.parseInt(text, 10) || 0
}

async function addToCart(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const { errors } = helpers
  const storeUuid = String(params.storeUuid || '')
  const itemUuid = String(params.itemUuid || '')
  const quantity = Number(params.quantity) || 1

  if (!storeUuid) throw errors.missingParam('storeUuid')
  if (!itemUuid) throw errors.missingParam('itemUuid')

  await ensureUberEatsPage(page)

  // Step 1: Validate store + resolve slug via API
  const storeData = await apiCall(page, helpers, 'getStoreV1', { storeUuid })
  const slug = storeData.slug
  if (!slug) throw errors.fatal('Could not resolve store slug')
  if (!storeData.isOpen) throw errors.retriable('Store is currently closed')

  // Step 2: Find item in catalog and resolve section/subsection UUIDs
  let sectionUuid = ''
  let subsectionUuid = ''
  const catalog = storeData.catalogSectionsMap
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
  if (!sectionUuid) throw errors.fatal(`Item ${itemUuid} not found in store menu`)

  // Step 3: Navigate to quickView URL — opens item modal directly
  const storeSlug = uuidToSlug(storeUuid)
  const modctx = JSON.stringify({ storeUuid, sectionUuid, subsectionUuid, itemUuid })
  const quickViewUrl = `${BASE}/store/${slug}/${storeSlug}?mod=quickView&modctx=${encodeURIComponent(modctx)}`

  await page.goto(quickViewUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {})

  // Step 4: Click "Add to order" — stable data-testid selector
  const addBtn = page.locator('[data-testid="add-to-cart-button"]')
  try {
    await addBtn.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    throw errors.retriable('Add to cart button not found — store may be closed or item unavailable')
  }

  // Set quantity if > 1
  if (quantity > 1) {
    const increaseBtn = page.locator('[data-testid="quantity-selector-increase"]')
    for (let i = 1; i < quantity; i++) {
      try { await increaseBtn.click({ timeout: 2000 }) } catch { break }
      await page.waitForTimeout(300)
    }
  }

  await addBtn.click({ timeout: 5000 })
  await page.waitForTimeout(1500)

  // Step 5: Verify via cart badge
  const cartCount = await readCartBadge(page)

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

  // Navigate to UberEats home
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(3000)

  // Check cart badge — if empty, nothing to remove
  const beforeCount = await readCartBadge(page)
  if (beforeCount === 0) {
    throw errors.retriable('Cart is empty — UberEats cart is in-memory only and does not persist across browser sessions')
  }

  // Open the cart by clicking the parent button of the cart badge
  const cartClicked = await page.evaluate(() => {
    const badge = document.querySelector('[data-testid="view-carts-badge"]')
    if (!badge) return false
    let el: Element | null = badge
    while (el) {
      if (el.tagName === 'BUTTON' || el.tagName === 'A') {
        (el as HTMLElement).click()
        return true
      }
      el = el.parentElement
    }
    (badge as HTMLElement).click()
    return true
  })

  if (!cartClicked) throw errors.retriable('Cart button not found')
  await page.waitForTimeout(3000)

  // Navigate to checkout if not already there
  if (!page.url().includes('/checkout')) {
    await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {})
    await page.waitForTimeout(3000)
  }

  // Look for remove/delete/decrease buttons
  const selectors = [
    '[data-testid="cart-item-delete-button"]',
    '[data-testid="delete-button"]',
    '[data-testid="remove-button"]',
    '[data-testid="quantity-selector-decrease"]',
    '[data-testid*="delete"]',
    '[data-testid*="remove"]',
    'button[aria-label*="Remove"]',
    'button[aria-label*="Delete"]',
  ]

  let clicked = false
  for (const sel of selectors) {
    const btn = page.locator(sel).first()
    try {
      await btn.waitFor({ state: 'visible', timeout: 2_000 })
      await btn.click({ timeout: 5000 })
      clicked = true
      await page.waitForTimeout(2000)
      break
    } catch {
      /* retry next selector */
    }
  }

  if (!clicked) {
    throw errors.retriable('Could not find remove button — cart UI may have changed')
  }

  const cartCount = await readCartBadge(page)

  return {
    success: true,
    itemUuid,
    cartCount,
  }
}

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, helpers: Helpers) => Promise<unknown>> = {
  addToCart,
  removeFromCart,
}

const adapter = {
  name: 'uber-eats',
  description: 'Uber Eats — cart operations via API validation + minimal DOM',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('ubereats.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies()
    return cookies.some(c => c.name === 'sid' || c.name === 'csid' || c.name === 'jwt-session')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: Helpers): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, { ...params }, helpers)
  },
}

export default adapter
