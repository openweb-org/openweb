/**
 * Amazon add-to-cart adapter — submits the buy-box form via Playwright request.
 *
 * The browser must already be on the product detail page (/dp/{asin}).
 * The adapter reads the CSRF token, offer listing ID, and session data
 * from the #addToCart form, then POSTs to the buy-box handler.
 *
 * SAFETY: This adds to cart only — never proceeds to checkout.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'

const BUY_BOX_PATH = '/gp/product/handle-buy-box/ref=dp_start-bbf_1_glance'

async function addToCart(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const asin = String(params.asin ?? '')
  if (!asin) throw OpenWebError.missingParam('asin')
  const quantity = Number(params.quantity ?? 1)

  // Ensure we're on the product page
  const currentUrl = page.url()
  if (!currentUrl.includes('/dp/')) {
    throw OpenWebError.needsPage('https://www.amazon.com/dp/{asin}')
  }

  // Extract form data from the page
  const formData = await page.evaluate(() => {
    const form = document.querySelector('#addToCart') as HTMLFormElement | null
    if (!form) return null
    const data: Record<string, string> = {}
    for (const input of form.querySelectorAll('input[name]') as NodeListOf<HTMLInputElement>) {
      if (input.name && input.value) data[input.name] = input.value
    }
    return data
  })

  if (!formData) {
    throw OpenWebError.apiError('addToCart', 'Could not find #addToCart form on page')
  }

  // Override quantity if specified
  formData['items[0.base][quantity]'] = String(quantity)
  // Ensure submit action is add-to-cart (not buy-now)
  formData['submit.add-to-cart'] = 'Add to cart'
  delete formData['isBuyNow']

  const urlParams = new URLSearchParams(formData)
  const url = `https://www.amazon.com${BUY_BOX_PATH}`

  const resp = await page.request.fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: currentUrl,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    data: urlParams.toString(),
  })

  // Amazon returns a redirect (302) or HTML page on success
  const status = resp.status()
  const text = await resp.text()

  // Check for cart count in response
  const cartCountMatch = text.match(/nav-cart-count[^>]*>(\d+)</)
  const cartItemCount = cartCountMatch ? parseInt(cartCountMatch[1], 10) : null

  // Success indicators: redirect to cart, or page contains "Added to Cart"
  const success = status === 200 || status === 302
    || text.includes('Added to Cart')
    || text.includes('huc-v2-order-row')

  return {
    success,
    asin,
    cartItemCount,
  }
}

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  addToCart,
}

const adapter: CodeAdapter = {
  name: 'amazon-cart',
  description: 'Amazon add-to-cart via buy-box form submission',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('amazon.com')
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw OpenWebError.unknownOp(operation)
      return await handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
