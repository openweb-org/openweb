import type { Page } from 'patchright'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function searchItems(
  page: Page,
  params: Record<string, unknown>,
  errors: { missingParam(name: string): Error },
) {
  const keywords = String(params.keywords || '')
  if (!keywords) throw errors.missingParam('keywords')
  const pageNum = Number(params.page) || 1

  let url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keywords)}`
  if (pageNum > 1) url += `&_pgn=${pageNum}`

  await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
  await wait(3000)

  return page.evaluate(`
    (() => {
      const cards = document.querySelectorAll('.s-card');
      const results = [];
      for (const card of cards) {
        const link = card.querySelector('a[href*="/itm/"]');
        if (!link) continue;
        const href = link.getAttribute('href') || '';
        const hrefMatch = href.match(/\\/itm\\/(\\d+)/);

        // Skip sponsored/placeholder cards (href points to /itm/123456)
        if (hrefMatch && hrefMatch[1] === '123456') continue;

        // Use data-listingid (stable), fall back to href regex
        const itemId = card.getAttribute('data-listingid') || (hrefMatch ? hrefMatch[1] : '');
        if (!itemId) continue;

        const title = card.querySelector('.s-card__title')?.textContent?.trim() || '';
        const price = card.querySelector('.s-card__price')?.textContent?.trim() || '';
        const subtitle = card.querySelector('.s-card__subtitle')?.textContent?.trim() || '';
        const img = card.querySelector('img');
        const image = img?.getAttribute('src') || '';

        results.push({
          itemId,
          title: title.replace(/Opens in a new window or tab$/i, '').trim(),
          price,
          condition: subtitle,
          image,
          link: 'https://www.ebay.com/itm/' + itemId,
        });
      }
      return { resultCount: results.length, items: results };
    })()
  `)
}

async function getItemDetail(
  page: Page,
  params: Record<string, unknown>,
  errors: { missingParam(name: string): Error },
) {
  const itemId = String(params.itemId || '')
  if (!itemId) throw errors.missingParam('itemId')

  await page.goto(`https://www.ebay.com/itm/${encodeURIComponent(itemId)}`, {
    waitUntil: 'load',
    timeout: 30_000,
  })
  await wait(3000)

  return page.evaluate(
    (id) => {
      const g = (sel: string) => document.querySelector(sel)?.textContent?.trim() || ''

      // Try LD+JSON first for structured data
      const ldScripts = document.querySelectorAll('script[type="application/ld+json"]')
      let ldProduct: any = null
      for (const s of ldScripts) {
        try {
          const d = JSON.parse(s.textContent!)
          if (d['@type'] === 'Product') {
            ldProduct = d
            break
          }
        } catch {}
      }

      // Seller info from DOM (not available in LD+JSON)
      const sellerCard = document.querySelector(
        '[data-testid="x-sellercard-atf"], .x-sellercard-atf_main',
      )
      const sellerName =
        sellerCard
          ?.querySelector(
            '.x-sellercard-atf__info__about-seller a, .x-sellercard-atf__info a',
          )
          ?.textContent?.trim() || ''
      const sellerFeedback =
        sellerCard?.querySelector('.x-sellercard-atf__about-seller')?.textContent?.trim() ||
        ''
      const sellerPositive =
        [...(sellerCard?.querySelectorAll('span') || [])].find((s) =>
          s.textContent?.includes('positive'),
        )?.textContent?.trim() || ''
      const storeLink = sellerCard?.querySelector('a[href*="/str/"]')
      const storeSlug = storeLink
        ? (storeLink.getAttribute('href') || '').match(/\/str\/([^?]+)/)?.[1] || ''
        : ''

      if (ldProduct) {
        const offer = ldProduct.offers || {}
        // Extract shipping from LD+JSON shippingDetails
        const shipDetail = Array.isArray(offer.shippingDetails)
          ? offer.shippingDetails[0]
          : offer.shippingDetails
        const shipRate = shipDetail?.shippingRate
        const shippingText = shipRate
          ? `${shipRate.currency} ${shipRate.value}`
          : g('[data-testid="x-shipping-header"] .ux-textspans') ||
            g('.ux-labels-values--shipping .ux-textspans--BOLD')

        // Extract return policy from LD+JSON
        const returnPolicy = Array.isArray(offer.hasMerchantReturnPolicy)
          ? offer.hasMerchantReturnPolicy[0]
          : offer.hasMerchantReturnPolicy
        const returnsText = returnPolicy?.merchantReturnDays
          ? `${returnPolicy.merchantReturnDays} day returns`
          : g('[data-testid="x-returns"] .ux-textspans--BOLD')

        return {
          itemId: id,
          title: ldProduct.name || '',
          price: offer.price ? `${offer.priceCurrency} ${offer.price}` : '',
          priceCurrency: offer.priceCurrency || '',
          priceValue: offer.price || '',
          condition: (offer.itemCondition || '').replace('https://schema.org/', ''),
          availability: (offer.availability || '').replace('https://schema.org/', ''),
          image: Array.isArray(ldProduct.image) ? ldProduct.image[0] : ldProduct.image || '',
          images: Array.isArray(ldProduct.image)
            ? ldProduct.image
            : [ldProduct.image].filter(Boolean),
          seller: {
            name: sellerName,
            feedbackScore: sellerFeedback,
            positivePercent: sellerPositive,
            storeSlug,
          },
          brand: ldProduct.brand?.name || '',
          model: ldProduct.model || '',
          shipping: shippingText,
          bids: g('.x-bid-count span') || g('[data-testid="x-bid-count"]'),
          returns: returnsText,
        }
      }

      // Fallback to DOM extraction
      return {
        itemId: id,
        title: g('.x-item-title__mainTitle span') || g('h1 span.ux-textspans') || g('h1'),
        price: g('.x-price-primary span.ux-textspans') || g('.x-bin-price__content'),
        condition:
          g('[data-testid="x-item-condition"] .ux-textspans') || g('.x-item-condition span'),
        image:
          document.querySelector('.ux-image-carousel-item img')?.getAttribute('src') || '',
        seller: {
          name: sellerName,
          feedbackScore: sellerFeedback,
          positivePercent: sellerPositive,
          storeSlug,
        },
        shipping:
          g('[data-testid="x-shipping-header"] .ux-textspans') ||
          g('.ux-labels-values--shipping .ux-textspans--BOLD'),
        bids: g('.x-bid-count span') || '',
        returns: g('[data-testid="x-returns"] .ux-textspans--BOLD'),
      }
    },
    itemId,
  )
}

async function getSellerProfile(
  page: Page,
  params: Record<string, unknown>,
  errors: { missingParam(name: string): Error },
) {
  const username = String(params.username || '')
  if (!username) throw errors.missingParam('username')

  await page.goto(`https://www.ebay.com/str/${encodeURIComponent(username)}`, {
    waitUntil: 'load',
    timeout: 30_000,
  })
  await wait(3000)

  return page.evaluate(
    (user) => {
      const notFound = document.querySelector('.page-notice--attention')
      if (notFound && notFound.textContent?.includes('not found')) {
        return { error: 'Seller not found', username: user }
      }

      const card = document.querySelector('.str-seller-card')
      if (!card) return { error: 'Could not load seller profile', username: user }

      const storeName =
        document.querySelector('.str-seller-card__store-name h1')?.textContent?.trim() || ''
      const fullText = card.textContent?.replace(/\s+/g, ' ')?.trim() || ''

      // Parse stats from text like "99.8% positive feedback 59K items sold 11K followers"
      const positiveMatch = fullText.match(/(\d+\.?\d*)%\s*positive/)
      const itemsSoldMatch = fullText.match(/(\d+\.?\d*[KMB]?)\s*items?\s*sold/i)
      const followersMatch = fullText.match(/(\d+\.?\d*[KMB]?)\s*followers?/i)

      const logo = document.querySelector('.str-header__logo--img') as HTMLImageElement

      const categoryCards = document.querySelectorAll('[data-testid="card-ajax-true"]')
      const categories = [...categoryCards]
        .slice(0, 10)
        .map((c) => c.textContent?.trim() || '')
        .filter(Boolean)

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
    },
    username,
  )
}

const adapter = {
  name: 'ebay',
  description: 'eBay — search items, view details, seller profiles',

  async init(page: Page): Promise<boolean> {
    return new URL(page.url()).hostname.includes('ebay.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { errors } = helpers as {
      errors: { unknownOp(op: string): Error; missingParam(name: string): Error }
    }
    switch (operation) {
      case 'searchItems':
        return searchItems(page, { ...params }, errors)
      case 'getItemDetail':
        return getItemDetail(page, { ...params }, errors)
      case 'getSellerProfile':
        return getSellerProfile(page, { ...params }, errors)
      default:
        throw errors.unknownOp(operation)
    }
  },
}

export default adapter
