import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Fetch cart items via Amazon's JSON API. Returns [{asin, merchantId, quantity, cartType}]. */
async function fetchCartItems(page: Page): Promise<Array<{ asin: string; merchantId: string; quantity: number; cartType: string }>> {
  return page.evaluate(async () => {
    try {
      const r = await fetch('/cart/add-to-cart/get-cart-items?clientName=SiteWideActionExecutor', {
        credentials: 'same-origin',
      })
      if (!r.ok) return []
      return r.json()
    } catch {
      return []
    }
  })
}

async function searchProducts(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const k = String(params.k || '')
  if (!k) throw errors.missingParam('k')
  const pg = Number(params.page) || 1
  const url = `https://www.amazon.com/s?k=${encodeURIComponent(k)}${pg > 1 ? `&page=${pg}` : ''}`
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)
  return page.evaluate(`
    (() => {
      const cards = document.querySelectorAll('[data-component-type="s-search-result"]');
      return {
        resultCount: cards.length,
        items: [...cards].map(c => ({
          asin: c.getAttribute('data-asin') || '',
          title: c.querySelector('h2 span')?.textContent?.trim() || '',
          price: c.querySelector('.a-price .a-offscreen')?.textContent?.trim() || '',
          rating: c.querySelector('.a-icon-alt')?.textContent?.trim() || '',
          link: 'https://www.amazon.com' + (c.querySelector('h2 a, a.a-link-normal.s-no-outline')?.getAttribute('href') || ''),
          image: c.querySelector('img.s-image')?.getAttribute('src') || '',
        })).filter(p => p.asin),
      };
    })()
  `)
}

async function getProductDetail(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const asin = String(params.asin || '')
  if (!asin) throw errors.missingParam('asin')
  await page.goto(`https://www.amazon.com/dp/${asin}`, { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)
  return page.evaluate(`
    (() => {
      const g = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
      const a = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || '';
      return {
        name: g('#productTitle'),
        price: g('.a-price .a-offscreen'),
        brand: g('#bylineInfo'),
        rating: g('#acrPopover .a-icon-alt'),
        reviewCount: g('#acrCustomerReviewText'),
        image: a('#landingImage, #imgBlkFront', 'src'),
        description: g('#productDescription p, #productDescription span'),
        features: [...document.querySelectorAll('#feature-bullets li span.a-list-item')]
          .map(e => e.textContent?.trim())
          .filter(Boolean),
      };
    })()
  `)
}

async function getProductReviews(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const asin = String(params.asin || '')
  if (!asin) throw errors.missingParam('asin')
  const pageNum = Number(params.pageNumber) || 1
  const sortBy = String(params.sortBy || 'helpful')
  let url = `https://www.amazon.com/product-reviews/${asin}?sortBy=${sortBy}`
  if (pageNum > 1) url += `&pageNumber=${pageNum}`
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)
  return page.evaluate(`
    (() => {
      const overallRating = document.querySelector('[data-hook="rating-out-of-text"]')?.textContent?.trim() || '';
      const totalReviews = document.querySelector('[data-hook="cr-filter-info-review-rating-count"]')?.textContent?.trim() || '';
      const reviews = document.querySelectorAll('[data-hook="review"]');
      return {
        overallRating,
        totalReviews,
        items: [...reviews].map(r => ({
          rating: r.querySelector('[data-hook="review-star-rating"] .a-icon-alt')?.textContent?.trim() || '',
          title: r.querySelector('[data-hook="review-title"] span:not(.a-icon-alt)')?.textContent?.trim() || '',
          body: r.querySelector('[data-hook="review-body"] span')?.textContent?.trim() || '',
          author: r.querySelector('.a-profile-name')?.textContent?.trim() || '',
          date: r.querySelector('[data-hook="review-date"]')?.textContent?.trim() || '',
        })),
      };
    })()
  `)
}

async function searchDeals(page: Page, params: Record<string, unknown>) {
  const startIndex = Number(params.startIndex) || 1
  const pageSize = Number(params.pageSize) || 20
  // Navigate to deals page to get proper cookies/context
  await page.goto('https://www.amazon.com/deals', { waitUntil: 'load', timeout: 30_000 })
  await wait(5000)

  const filters = String(params.filters || JSON.stringify({
    includedDepartments: [], excludedDepartments: [],
    includedTags: [], excludedTags: ['restrictedasin', 'noprime'],
    promotionTypes: [], accessTypes: [], brandIds: [], unifiedIds: [],
  }))
  const rankingContext = String(params.rankingContext || JSON.stringify({
    pageTypeId: 'deals', rankGroup: 'ESPEON_RANKING',
  }))

  // Must pass filters and rankingContext — API returns 400 "AAPI client validation failure" without them
  return page.evaluate(async ([si, ps, filt, rank]: string[]) => {
    const qs = new URLSearchParams({
      startIndex: si,
      pageSize: ps,
      calculateRefinements: 'false',
      filters: filt,
      rankingContext: rank,
    })
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    try {
      const r = await fetch(`/d2b/api/v1/products/search?${qs}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    } finally {
      clearTimeout(timer)
    }
  }, [String(startIndex), String(pageSize), filters, rankingContext])
}

async function addToCart(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const asin = String(params.asin || '')
  if (!asin) throw errors.missingParam('asin')
  const quantity = Number(params.quantity) || 1

  // Snapshot cart before add
  const cartBefore = await fetchCartItems(page)
  const qtyBefore = cartBefore.find(i => i.asin === asin)?.quantity ?? 0

  // Navigate to product page
  await page.goto(`https://www.amazon.com/dp/${asin}`, { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)

  // Set quantity if > 1
  if (quantity > 1) {
    await page.evaluate((qty: number) => {
      const sel = document.querySelector('#quantity') as HTMLSelectElement | null
      if (sel) sel.value = String(qty)
    }, quantity)
  }

  // Click "Add to Cart" button via patchright (triggers Amazon's JS properly)
  const addBtn = page.locator('#add-to-cart-button')
  await addBtn.click({ timeout: 10_000 })
  await wait(3000)

  // Read cart state from JSON API instead of fragile DOM selectors
  const cartAfter = await fetchCartItems(page)
  const totalQty = cartAfter.reduce((sum, i) => sum + i.quantity, 0)
  const itemAfter = cartAfter.find(i => i.asin === asin)

  return {
    success: !!itemAfter && itemAfter.quantity > qtyBefore,
    cartCount: totalQty,
    message: itemAfter ? 'Added to cart' : 'Add to cart may have failed',
    item: { asin, quantity: itemAfter?.quantity ?? 0 },
    subtotal: '', // not available from JSON API
  }
}

async function getCart(page: Page, _params: Record<string, unknown>) {
  // Navigate to cart page for DOM enrichment (title, price, image)
  await page.goto('https://www.amazon.com/gp/cart/view.html', { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)

  // Primary: JSON API for definitive item list (asin + quantity)
  const apiItems = await fetchCartItems(page)

  // Enrich with DOM data attributes (title, price, image) — data-* attrs are more stable than class selectors
  const domData = await page.evaluate(() => {
    const cartItems = document.querySelectorAll('[data-asin][data-itemtype="active"]')
    const subtotal = document.querySelector('#sc-subtotal-amount-activecart .sc-price')?.textContent?.trim() || ''
    const map: Record<string, { title: string; price: string; image: string }> = {}
    for (const el of cartItems) {
      const asin = el.getAttribute('data-asin') || ''
      if (!asin) continue
      const price = el.getAttribute('data-price') || ''
      map[asin] = {
        title: el.querySelector('.sc-product-title .a-truncate-full, .sc-item-title-content')?.textContent?.trim() || '',
        price: price ? `$${Number(price).toFixed(2)}` : el.querySelector('.a-offscreen')?.textContent?.trim() || '',
        image: (el.querySelector('img.sc-product-image') as HTMLImageElement)?.src
          || el.querySelector('.sc-product-image img, .sc-item-image img')?.getAttribute('src') || '',
      }
    }
    return { subtotal, map }
  }) as { subtotal: string; map: Record<string, { title: string; price: string; image: string }> }

  return {
    cartCount: apiItems.reduce((sum, i) => sum + i.quantity, 0),
    subtotal: domData.subtotal,
    items: apiItems.map(i => ({
      asin: i.asin,
      title: domData.map[i.asin]?.title || '',
      price: domData.map[i.asin]?.price || '',
      quantity: i.quantity,
      image: domData.map[i.asin]?.image || '',
    })),
  }
}

async function removeFromCart(page: Page, params: Record<string, unknown>, errors: { missingParam(name: string): Error }) {
  const asin = String(params.asin || '')
  if (!asin) throw errors.missingParam('asin')

  await page.goto('https://www.amazon.com/gp/cart/view.html', { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)

  // Find the delete button for this ASIN via DOM — need the data-action locator
  const btnSelector = await page.evaluate((targetAsin: string) => {
    const items = document.querySelectorAll('[data-asin][data-itemtype="active"]')
    for (const el of items) {
      if (el.getAttribute('data-asin') === targetAsin) {
        const deleteBtn = el.querySelector<HTMLInputElement>('input[data-action="delete-active"]')
        if (deleteBtn?.name) return deleteBtn.name
      }
    }
    return null
  }, asin)

  if (!btnSelector) {
    return { success: false, message: `Item ${asin} not found in cart` }
  }

  // Use patchright native click — triggers Amazon's JS event handlers properly
  // (DOM .click() from page.evaluate doesn't trigger Amazon's AJAX delete)
  const escapedName = btnSelector.replace(/\./g, '\\.')
  const deleteBtn = page.locator(`input[name="${escapedName}"]`)
  await deleteBtn.click({ timeout: 10_000 })
  await wait(3000)

  // Verify removal via JSON API
  const cartAfter = await fetchCartItems(page)
  const stillInCart = cartAfter.some(i => i.asin === asin)
  const totalQty = cartAfter.reduce((sum, i) => sum + i.quantity, 0)

  return {
    success: !stillInCart,
    message: stillInCart ? 'Remove may have failed' : 'Removed from cart',
    removedItem: { asin },
    cartCount: totalQty,
    subtotal: '',
  }
}

async function getBestSellers(page: Page, _params: Record<string, unknown>) {
  await page.goto('https://www.amazon.com/gp/bestsellers/', { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)
  return page.evaluate(`
    (() => {
      const items = document.querySelectorAll('.p13n-sc-uncoverable-faceout');
      return {
        items: [...items].map((el, i) => {
          const links = [...el.querySelectorAll('a')];
          const titleLink = links.find(a => a.textContent?.trim() && !a.textContent.includes('out of 5') && !a.textContent.startsWith('$'));
          return {
            rank: i + 1,
            title: titleLink?.textContent?.trim() || '',
            price: el.querySelector('[class*="price"]')?.textContent?.trim() || '',
            rating: el.querySelector('.a-icon-alt')?.textContent?.trim() || '',
            link: titleLink?.getAttribute('href') || '',
            image: el.querySelector('img')?.getAttribute('src') || '',
          };
        }).filter(p => p.title),
      };
    })()
  `)
}

const adapter: CustomRunner = {
  name: 'amazon',
  description: 'Amazon — search products, view details, read reviews, browse deals, manage cart',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const { errors } = helpers as unknown as { errors: { unknownOp(op: string): Error; missingParam(name: string): Error } }
    const p = page as Page
    switch (operation) {
      case 'searchProducts': return searchProducts(p, { ...params }, errors)
      case 'getProductDetail': return getProductDetail(p, { ...params }, errors)
      case 'getProductReviews': return getProductReviews(p, { ...params }, errors)
      case 'searchDeals': return searchDeals(p, { ...params })
      case 'getBestSellers': return getBestSellers(p, { ...params })
      case 'addToCart': return addToCart(p, { ...params }, errors)
      case 'removeFromCart': return removeFromCart(p, { ...params }, errors)
      case 'getCart': return getCart(p, { ...params })
      default: throw errors.unknownOp(operation)
    }
  },
}

export default adapter
