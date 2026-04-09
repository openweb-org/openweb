import type { Page } from 'patchright'

/**
 * Wayfair adapter — DOM extraction via in-page navigation.
 *
 * PerimeterX blocks page.goto() navigations (detectable as automation).
 * All navigation uses window.location.href from within page.evaluate(),
 * which looks identical to user-initiated navigation.
 */

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
  botBlocked(msg: string): Error
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BASE = 'https://www.wayfair.com'

// ── Shared helpers ──────────────────────────────

/** Navigate via window.location (avoids Playwright goto fingerprint). */
async function navigateInPage(page: Page, url: string, timeoutMs = 30_000): Promise<void> {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load', timeout: timeoutMs }),
    page.evaluate((u: string) => { window.location.href = u }, url),
  ])
  await wait(2000)
}

/** Check for PerimeterX bot block signals on the current page. */
async function checkBotBlock(page: Page, context: string, errors: Errors): Promise<void> {
  const blocked = await page.evaluate(() => {
    const t = document.title.toLowerCase()
    if (t.includes('denied')) return 'Access Denied'
    if (document.querySelector('#px-captcha')) return 'CAPTCHA challenge'
    return null
  })
  if (blocked) throw errors.botBlocked(`bot detection blocked (${blocked}) — ${context}`)
}

// ── Operations ──────────────────────────────────

async function searchProducts(page: Page, params: Record<string, unknown>, errors: Errors) {
  const keyword = String(params.keyword || params.query || params.q || '')
  if (!keyword) throw errors.missingParam('keyword')

  // If not already on wayfair.com, navigate there
  if (!page.url().includes('wayfair.com')) {
    await navigateInPage(page, BASE)
  }

  await checkBotBlock(page, 'search')

  // Use the on-page search bar
  const input = await page.waitForSelector('input[type="search"], input[name="keyword"]', { timeout: 8000 })
  if (!input) throw errors.fatal('search bar not found on page')
  await input.click({ clickCount: 3 }) // select all existing text
  await wait(200)
  await input.fill(keyword)
  await wait(300)

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load', timeout: 20_000 }),
    page.keyboard.press('Enter'),
  ])
  await wait(2000)

  await checkBotBlock(page, 'search results')

  const result = await page.evaluate((kw: string) => {
    const links = Array.from(document.querySelectorAll('a[href*="/pdp/"]'))
    const seen = new Set<string>()
    const products: Array<Record<string, unknown>> = []

    for (const link of links) {
      const a = link as HTMLAnchorElement
      const href = a.href
      const skuMatch = href.match(/-(w\d+)\.html/)
      if (!skuMatch) continue
      const sku = skuMatch[1]
      if (seen.has(sku)) continue
      seen.add(sku)

      // Walk up to find the product card container
      let card: HTMLElement = a
      for (let i = 0; i < 12; i++) {
        const parent = card.parentElement
        if (!parent) break
        if (parent.querySelectorAll('a[href*="/pdp/"]').length > 2) break
        card = parent
      }

      const text = card.innerText || ''

      // Product name from image alt or nearby text elements
      const img = card.querySelector('img[src*="wfcdn"]') as HTMLImageElement | null
      let name = img?.alt || ''
      if (!name || name.length < 5) {
        const els = card.querySelectorAll('p, span, h2, h3, h4')
        for (const el of els) {
          const t = el.textContent?.trim() || ''
          if (t.length > 15 && !t.startsWith('$') && !/Rated|star|Sale|Deal|Closeout/i.test(t)) {
            name = t
            break
          }
        }
      }
      if (!name || name.length < 5) {
        const slugMatch = href.match(/\/pdp\/(.+)-(w\d+)\.html/)
        if (slugMatch) {
          name = decodeURIComponent(slugMatch[1])
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase())
        }
      }
      if (!name) name = sku

      const priceMatches = text.match(/\$[\d,]+\.?\d*/g) || []
      const currentPrice = priceMatches[0] ? Number.parseFloat(priceMatches[0].replace(/[$,]/g, '')) : null
      const originalPrice = priceMatches.length > 1 ? Number.parseFloat(priceMatches[1].replace(/[$,]/g, '')) : null

      const ratingMatch = text.match(/Rated ([\d.]+) out of 5/)
      const rating = ratingMatch ? Number.parseFloat(ratingMatch[1]) : null

      const voteMatch = text.match(/(\d+) total votes?/)
      const reviewCount = voteMatch ? Number.parseInt(voteMatch[1]) : 0

      const image = img?.src || ''

      products.push({
        sku, name, url: href.split('?')[0],
        currentPrice, originalPrice, rating, reviewCount, image,
      })

      if (products.length >= 48) break
    }

    return {
      keyword: new URLSearchParams(window.location.search).get('keyword')
        || new URLSearchParams(window.location.search).get('redir')
        || kw,
      products,
    }
  }, keyword)

  return {
    keyword: result.keyword || keyword,
    totalProducts: result.products.length,
    products: result.products,
  }
}

async function getProductDetail(page: Page, params: Record<string, unknown>, errors: Errors) {
  const sku = String(params.sku || params.itemId || params.id || '')
  if (!sku) throw errors.missingParam('sku')

  const productUrl = `${BASE}/furniture/pdp/-${sku}.html`
  await navigateInPage(page, productUrl)

  await checkBotBlock(page, 'product page')

  const result = await page.evaluate(() => {
    const data: Record<string, unknown> = {}

    const h1 = document.querySelector('h1')
    data.name = h1?.textContent?.trim() || ''

    const mfgSpec = Array.from(document.querySelectorAll('th')).find(
      (th) => th.textContent?.trim() === 'Manufacturer',
    )
    const pageTitle = document.title
    const brandFromTitle = pageTitle.replace(/\s*&\s*Reviews.*$/, '').replace(/\s+\S+$/, '')
    data.brand = mfgSpec?.nextElementSibling?.textContent?.trim() || brandFromTitle || ''

    const skuMatch = window.location.pathname.match(/-(w\d+)\.html/)
    data.sku = skuMatch ? skuMatch[1] : ''

    const ogDesc = document.querySelector('meta[property="og:description"]')
    data.description = ogDesc?.getAttribute('content') || ''

    const bodyText = document.body.innerText
    const ratingMatch = bodyText.match(/([\d.]+)\s*out of\s*5/)
    data.rating = ratingMatch ? Number.parseFloat(ratingMatch[1]) : null

    const reviewCountMatch = bodyText.match(/([\d,]+)\s*Reviews?/i)
    data.reviewCount = reviewCountMatch ? Number.parseInt(reviewCountMatch[1].replace(/,/g, '')) : 0

    const priceMatches = bodyText.match(/\$[\d,]+\.\d{2}/g) || []
    data.currentPrice = priceMatches[0] ? Number.parseFloat(priceMatches[0].replace(/[$,]/g, '')) : null
    data.originalPrice = priceMatches.length > 1 ? Number.parseFloat(priceMatches[1].replace(/[$,]/g, '')) : null

    const imgs = Array.from(document.querySelectorAll('img[src*="wfcdn"]'))
      .map((i) => (i as HTMLImageElement).src)
      .filter((s) => !s.includes('resize-h50') && !s.includes('resize-h30') && !s.includes('resize-h36'))
    data.images = [...new Set(imgs)].slice(0, 10)

    const specs: Array<{ name: string; value: string }> = []
    for (const th of document.querySelectorAll('th')) {
      const key = th.textContent?.trim()
      const td = th.nextElementSibling
      const val = td?.textContent?.trim()
      if (key && val && key.length < 60 && val.length < 200) {
        specs.push({ name: key, value: val })
      }
    }
    data.specifications = specs
    data.url = window.location.href.split('?')[0]

    return data
  })

  return result
}

async function getReviews(page: Page, params: Record<string, unknown>, errors: Errors) {
  const sku = String(params.sku || params.itemId || params.id || '')
  if (!sku) throw errors.missingParam('sku')

  const productUrl = `${BASE}/furniture/pdp/-${sku}.html`
  await navigateInPage(page, productUrl)

  await checkBotBlock(page, 'reviews page')

  // Scroll to reviews section
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('h2, h3, h4, span'))
    const target = els.find((el) => /customer review/i.test(el.textContent || ''))
    if (target) target.scrollIntoView({ behavior: 'instant' })
    else window.scrollTo(0, document.body.scrollHeight * 0.7)
  })
  await wait(2000)

  const result = await page.evaluate((skuArg: string) => {
    const bodyText = document.body.innerText

    const ratingMatch = bodyText.match(/([\d.]+)\s*out of\s*5/)
    const overallRating = ratingMatch ? Number.parseFloat(ratingMatch[1]) : null

    const countMatch = bodyText.match(/([\d,]+)\s*Reviews?/i)
    const totalReviews = countMatch ? Number.parseInt(countMatch[1].replace(/,/g, '')) : 0

    const reviewSection = bodyText.match(
      /Customer Reviews[\s\S]*?(?:Show More|Load More|$)/,
    )
    const reviewText = reviewSection ? reviewSection[0] : ''

    const reviewBlocks = reviewText.split(/(?=Rated \d out of 5 stars\.)/)
    const reviews: Array<Record<string, unknown>> = []

    for (const block of reviewBlocks) {
      const rMatch = block.match(/Rated (\d) out of 5 stars\./)
      if (!rMatch) continue

      const rating = Number.parseInt(rMatch[1])
      const lines = block.split('\n').filter((l) => l.trim())
      const contentLines = lines.slice(1)
      if (contentLines.length < 2) continue

      const author = contentLines[0]?.trim() || ''
      const dateMatch = block.match(/(\d{2}\/\d{2}\/\d{4})/)
      const date = dateMatch ? dateMatch[1] : ''

      let loc = ''
      let verified = false
      let textStartIdx = 1

      for (let i = 1; i < contentLines.length; i++) {
        const line = contentLines[i]?.trim() || ''
        if (line === 'Verified Buyer') {
          verified = true
          textStartIdx = i + 1
        } else if (/^[A-Z]{2}$/.test(line) || /,\s*[A-Z]{2}$/.test(line)) {
          loc = line
          textStartIdx = i + 1
        } else {
          textStartIdx = i
          break
        }
      }

      const textLines = contentLines.slice(textStartIdx)
      const text = textLines
        .filter((l) => !/^\d{2}\/\d{2}\/\d{4}$/.test(l.trim()))
        .join(' ')
        .trim()

      if (text.length > 5) {
        reviews.push({
          rating, author, location: loc || null, verified,
          text: text.substring(0, 1000), date,
        })
      }

      if (reviews.length >= 10) break
    }

    // Use the passed sku arg as fallback, extract from URL if possible
    const urlSku = window.location.pathname.match(/-(w\d+)\.html/)?.[1] || skuArg

    return { sku: urlSku, overallRating, totalReviews, reviews }
  }, sku)

  return result
}

// ── Adapter export ──────────────────────────────

const OPERATIONS: Record<
  string,
  (page: Page, params: Record<string, unknown>, errors: Errors) => Promise<unknown>
> = {
  searchProducts,
  getProductDetail,
  getReviews,
}

const adapter = {
  name: 'wayfair-web',
  description: 'Wayfair — search, product detail, and reviews via DOM extraction',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('wayfair.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: { errors: Errors },
  ): Promise<unknown> {
    const { errors } = helpers
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page, { ...params }, errors)
  },
}

export default adapter
