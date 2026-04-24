import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

type Params = Readonly<Record<string, unknown>>

const BASE = 'https://www.ebay.com'

async function navigateAndWait(page: Page, url: string, readySelector: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  // eBay may redirect to /splashui/challenge — a JS challenge that auto-resolves in ~10s.
  // waitForSelector survives the cross-page redirect back to the target URL.
  await page.waitForSelector(readySelector, { timeout: 20_000 }).catch(() => {})
}

async function searchItems(page: Page, params: Params): Promise<unknown> {
  const keywords = String(params.keywords || '')
  const pageNum = Number(params.page) || 1
  let url = `${BASE}/sch/i.html?_nkw=${encodeURIComponent(keywords)}`
  if (pageNum > 1) url += `&_pgn=${pageNum}`

  await navigateAndWait(page, url, '.s-card')

  return page.evaluate((max: number) => {
    const cards = document.querySelectorAll('.s-card')
    const items: Record<string, unknown>[] = []
    const seen = new Set<string>()
    for (const card of cards) {
      if (items.length >= max) break
      const link = card.querySelector('a[href*="/itm/"]')
      if (!link) continue
      const href = link.getAttribute('href') || ''
      const hrefMatch = href.match(/\/itm\/(\d+)/)
      if (hrefMatch && hrefMatch[1] === '123456') continue
      const itemId = card.getAttribute('data-listingid') || (hrefMatch ? hrefMatch[1] : '')
      if (!itemId || seen.has(itemId)) continue
      seen.add(itemId)
      const title = card.querySelector('.s-card__title')?.textContent?.trim() || ''
      const price = card.querySelector('.s-card__price')?.textContent?.trim() || ''
      const condition = card.querySelector('.s-card__subtitle')?.textContent?.trim() || ''
      items.push({
        itemId,
        title: title.replace(/Opens in a new window or tab$/i, '').trim(),
        price,
        condition,
        link: `https://www.ebay.com/itm/${itemId}`,
      })
    }
    return { resultCount: items.length, items }
  }, 15)
}

async function getItemDetail(page: Page, params: Params): Promise<unknown> {
  const itemId = String(params.itemId || '')
  const url = `${BASE}/itm/${encodeURIComponent(itemId)}`

  await navigateAndWait(page, url, '.x-item-title__mainTitle, script[type="application/ld+json"]')

  return page.evaluate((id: string) => {
    const g = (sel: string) => document.querySelector(sel)?.textContent?.trim() || ''
    const decode = (s: string) => {
      const el = document.createElement('textarea')
      el.innerHTML = s
      return el.value
    }

    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]')
    let ldProduct: Record<string, any> | null = null
    for (const s of ldScripts) {
      try {
        const d = JSON.parse(s.textContent ?? '')
        if (d['@type'] === 'Product') { ldProduct = d; break }
      } catch {}
    }

    const sellerCard = document.querySelector('[data-testid="x-sellercard-atf"], .x-sellercard-atf_main')
    const sellerName = sellerCard?.querySelector('.x-sellercard-atf__info__about-seller a, .x-sellercard-atf__info a')?.textContent?.trim() || ''
    const sellerFeedback = sellerCard?.querySelector('.x-sellercard-atf__about-seller')?.textContent?.trim() || ''
    const sellerPositive = [...(sellerCard?.querySelectorAll('span') || [])].find(
      s => s.textContent?.includes('positive'),
    )?.textContent?.trim() || ''
    const storeLink = sellerCard?.querySelector('a[href*="/str/"]')
    const storeSlug = storeLink ? (storeLink.getAttribute('href') || '').match(/\/str\/([^?]+)/)?.[1] || '' : ''

    const seller = { name: sellerName, feedbackScore: sellerFeedback, positivePercent: sellerPositive, storeSlug }

    if (ldProduct) {
      const offer = ldProduct.offers || {}
      const shipDetail = Array.isArray(offer.shippingDetails) ? offer.shippingDetails[0] : offer.shippingDetails
      const shipRate = shipDetail?.shippingRate
      const shippingText = shipRate
        ? `${shipRate.currency} ${shipRate.value}`
        : g('[data-testid="x-shipping-header"] .ux-textspans')
      const returnPolicy = Array.isArray(offer.hasMerchantReturnPolicy)
        ? offer.hasMerchantReturnPolicy[0]
        : offer.hasMerchantReturnPolicy
      const returnsText = returnPolicy?.merchantReturnDays
        ? `${returnPolicy.merchantReturnDays} day returns`
        : g('[data-testid="x-returns"] .ux-textspans--BOLD')

      const allImages: string[] = Array.isArray(ldProduct.image)
        ? ldProduct.image
        : [ldProduct.image].filter(Boolean)

      return {
        itemId: id,
        title: decode(ldProduct.name || ''),
        price: offer.price ? `${offer.priceCurrency} ${offer.price}` : '',
        priceCurrency: offer.priceCurrency || '',
        priceValue: offer.price || '',
        condition: (offer.itemCondition || '').replace('https://schema.org/', ''),
        availability: (offer.availability || '').replace('https://schema.org/', ''),
        image: allImages[0] || '',
        images: allImages.slice(0, 5),
        brand: ldProduct.brand?.name || '',
        model: ldProduct.model || '',
        seller,
        shipping: shippingText,
        bids: g('.x-bid-count span') || g('[data-testid="x-bid-count"]'),
        returns: returnsText,
      }
    }

    const img = document.querySelector('.ux-image-carousel-item img')?.getAttribute('src') || ''
    return {
      itemId: id,
      title: g('.x-item-title__mainTitle span') || g('h1 span.ux-textspans') || g('h1'),
      price: g('.x-price-primary span.ux-textspans') || g('.x-bin-price__content'),
      condition: g('[data-testid="x-item-condition"] .ux-textspans') || g('.x-item-condition span'),
      image: img,
      images: img ? [img] : [],
      seller,
      shipping: g('[data-testid="x-shipping-header"] .ux-textspans'),
      bids: g('.x-bid-count span'),
      returns: g('[data-testid="x-returns"] .ux-textspans--BOLD'),
    }
  }, itemId)
}

async function getSellerProfile(page: Page, params: Params): Promise<unknown> {
  const username = String(params.username || '')
  const url = `${BASE}/str/${encodeURIComponent(username)}`

  await navigateAndWait(page, url, '.str-seller-card')

  return page.evaluate((user: string) => {
    const notFound = document.querySelector('.page-notice--attention')
    if (notFound?.textContent?.includes('not found')) {
      return { error: 'Seller not found', username: user }
    }
    const card = document.querySelector('.str-seller-card')
    if (!card) return { error: 'Could not load seller profile', username: user }
    const storeName = document.querySelector('.str-seller-card__store-name h1')?.textContent?.trim() || ''
    const fullText = card.textContent?.replace(/\s+/g, ' ')?.trim() || ''
    const positiveMatch = fullText.match(/(\d+\.?\d*)%\s*positive/)
    const itemsSoldMatch = fullText.match(/(\d+\.?\d*[KMB]?)\s*items?\s*sold/i)
    const followersMatch = fullText.match(/(\d+\.?\d*[KMB]?)\s*followers?/i)
    const logo = document.querySelector('.str-header__logo--img')
    const categoryCards = document.querySelectorAll('[data-testid="card-ajax-true"]')
    const categories = [...categoryCards].slice(0, 5).map(c => c.textContent?.trim() || '').filter(Boolean)
    return {
      username: user,
      storeName,
      logoUrl: logo?.getAttribute('src') || '',
      positiveFeedback: positiveMatch ? `${positiveMatch[1]}%` : '',
      itemsSold: itemsSoldMatch ? itemsSoldMatch[1] : '',
      followers: followersMatch ? followersMatch[1] : '',
      categories,
      storeUrl: `https://www.ebay.com/str/${user}`,
    }
  }, username)
}

const OPERATIONS: Record<string, (page: Page, params: Params) => Promise<unknown>> = {
  searchItems,
  getItemDetail,
  getSellerProfile,
}

const adapter: CustomRunner = {
  name: 'ebay',
  description: 'eBay — CAPTCHA-resilient search + detail with response trimming',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('eBay requires a browser page')
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, params)
  },
}

export default adapter
