import type { Page } from 'patchright'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

  // Click "Add to Cart" button
  const addBtn = page.locator('#add-to-cart-button')
  await addBtn.click({ timeout: 10_000 })
  await wait(3000)

  // Extract confirmation from the post-add page or side panel
  return page.evaluate(`
    (() => {
      // Side-sheet confirmation (most common)
      const cartCount = document.querySelector('#nav-cart-count')?.textContent?.trim() || '';
      const confirmMsg = document.querySelector('#NATC_SMART_WAGON_CONF_MSG_SUCCESS, #huc-v2-order-row-confirm-text, [data-csa-c-content-id="sw-atc-confirmation"]')?.textContent?.trim() || '';
      const subtotal = document.querySelector('#sc-subtotal-amount-activecart .sc-price, #sw-subtotal .a-color-price, #hlb-subcart .a-color-price')?.textContent?.trim() || '';
      const itemTitle = document.querySelector('#huc-v2-order-row-title, .sw-atc-item-title, #productTitle')?.textContent?.trim() || '';
      const itemPrice = document.querySelector('#huc-v2-order-row-price, .sw-atc-item-price')?.textContent?.trim() || '';
      return {
        success: true,
        cartCount: cartCount ? parseInt(cartCount, 10) : null,
        message: confirmMsg || 'Added to cart',
        item: { title: itemTitle, price: itemPrice },
        subtotal,
      };
    })()
  `)
}

async function getCart(page: Page, _params: Record<string, unknown>) {
  await page.goto('https://www.amazon.com/gp/cart/view.html', { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)

  return page.evaluate(`
    (() => {
      const cartItems = document.querySelectorAll('[data-asin][data-itemtype="active"]');
      const subtotal = document.querySelector('#sc-subtotal-amount-activecart .sc-price')?.textContent?.trim() || '';
      const cartCount = document.querySelector('#nav-cart-count')?.textContent?.trim() || '0';
      return {
        cartCount: parseInt(cartCount, 10) || 0,
        subtotal,
        items: [...cartItems].map(el => {
          const asin = el.getAttribute('data-asin') || '';
          const title = el.querySelector('.sc-product-title .a-truncate-full, .sc-item-title-content')?.textContent?.trim() || '';
          const price = el.querySelector('.sc-product-price, .sc-item-price .a-offscreen')?.textContent?.trim() || '';
          const quantity = el.querySelector('.a-dropdown-prompt, .sc-quantity-textfield')?.textContent?.trim()
            || el.querySelector('input[name="quantity"]')?.value || '1';
          const image = el.querySelector('.sc-product-image img, .sc-item-image img')?.getAttribute('src') || '';
          return { asin, title, price, quantity: parseInt(quantity, 10) || 1, image };
        }).filter(i => i.asin),
      };
    })()
  `)
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

const adapter = {
  name: 'amazon',
  description: 'Amazon — search products, view details, read reviews, browse deals, manage cart',

  async init(page: Page): Promise<boolean> {
    // Accept any page — each operation navigates to the correct URL
    return true
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // All ops are public reads
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { errors } = helpers as { errors: { unknownOp(op: string): Error; missingParam(name: string): Error } }
    switch (operation) {
      case 'searchProducts': return searchProducts(page, { ...params }, errors)
      case 'getProductDetail': return getProductDetail(page, { ...params }, errors)
      case 'getProductReviews': return getProductReviews(page, { ...params }, errors)
      case 'searchDeals': return searchDeals(page, { ...params })
      case 'getBestSellers': return getBestSellers(page, { ...params })
      case 'addToCart': return addToCart(page, { ...params }, errors)
      case 'getCart': return getCart(page, { ...params })
      default: throw errors.unknownOp(operation)
    }
  },
}

export default adapter
