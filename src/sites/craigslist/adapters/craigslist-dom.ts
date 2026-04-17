import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

type AdapterErrors = { botBlocked(msg: string): Error; unknownOp(op: string): Error; wrap(error: unknown): Error }

/** Navigate to a Craigslist URL with the given city subdomain. */
async function navigateTo(page: Page, city: string, path: string, errors: AdapterErrors): Promise<void> {
  const url = `https://${city}.craigslist.org${path}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {})
  const currentUrl = page.url()
  if (currentUrl.includes('blocked') || currentUrl.includes('captcha')) {
    throw errors.botBlocked('Blocked by Craigslist')
  }
  await page.waitForSelector('body', { timeout: 5_000 }).catch(() => {})
}

async function searchListings(page: Page, params: Record<string, unknown>, errors: AdapterErrors): Promise<unknown> {
  const city = (params.city as string) || 'sfbay'
  const category = params.category as string
  const query = params.query as string | undefined
  const qs = query ? `?query=${encodeURIComponent(query)}` : ''
  await navigateTo(page, city, `/search/${category}${qs}`, errors)

  // Wait for SPA results to render (craigslist is a JS SPA)
  await page.waitForSelector('.cl-search-result, .gallery-card', { timeout: 8_000 }).catch(() => {})

  return page.evaluate(() => {
    const listings: Record<string, unknown>[] = []

    // Strategy 1: SPA-rendered result cards (.cl-search-result)
    const cards = document.querySelectorAll('.cl-search-result')
    if (cards.length > 0) {
      for (const card of cards) {
        const titleEl = card.querySelector('.posting-title .label, .label, .titlestring')
        const title = titleEl?.textContent?.trim() || card.getAttribute('title') || ''
        const link = card.querySelector('a.posting-title, a.cl-app-anchor, a')
        const url = link?.getAttribute('href') || ''
        const priceEl = card.querySelector('.priceinfo')
        const price = priceEl?.textContent?.trim() || null
        const locEl = card.querySelector('.result-location')
        const location = locEl?.textContent?.trim() || null
        const dateEl = card.querySelector('.result-posted-date')
        const date = dateEl?.textContent?.trim() || null
        const postId = card.getAttribute('data-pid') || null
        listings.push({ title, url, price, location, date, postId })
      }
    }

    // Strategy 2: static search results (no-JS fallback rendered server-side)
    if (listings.length === 0) {
      const statics = document.querySelectorAll('.cl-static-search-result')
      for (const item of statics) {
        const link = item.querySelector('a')
        const title = item.querySelector('.title')?.textContent?.trim() || link?.textContent?.trim() || ''
        const url = link?.getAttribute('href') || ''
        const priceEl = item.querySelector('.price')
        const price = priceEl?.textContent?.trim() || null
        const locEl = item.querySelector('.location')
        const location = locEl?.textContent?.trim() || null
        const idMatch = url.match(/\/(\d+)\.html/)
        listings.push({ title, url, price, location, date: null, postId: idMatch ? idMatch[1] : null })
      }
    }

    // Strategy 3: JSON-LD structured data (always present in page source)
    if (listings.length === 0) {
      const ldEl = document.getElementById('ld_searchpage_results')
      if (ldEl) {
        try {
          const ld = JSON.parse(ldEl.textContent || '{}')
          const items = ld.itemListElement || []
          for (const entry of items) {
            const item = entry.item || {}
            const addr = item.address || {}
            listings.push({
              title: item.name || '',
              url: '',
              price: null,
              location: [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', ') || null,
              date: null,
              postId: null,
            })
          }
        } catch { /* ignore parse errors */ }
      }
    }

    // Strategy 4: legacy rows
    if (listings.length === 0) {
      const rows = document.querySelectorAll('.result-row, li.result')
      for (const row of rows) {
        const link = row.querySelector('a.result-title, a.hdrlnk, a')
        const title = link?.textContent?.trim() || ''
        const url = link?.getAttribute('href') || ''
        const priceEl = row.querySelector('.result-price, .price')
        const price = priceEl?.textContent?.trim() || null
        const hoodEl = row.querySelector('.result-hood, .nearby')
        const location = hoodEl?.textContent?.trim()?.replace(/[()]/g, '') || null
        const timeEl = row.querySelector('time')
        const date = timeEl?.getAttribute('datetime') || null
        const idMatch = url.match(/\/(\d+)\.html/)
        listings.push({ title, url, price, location, date, postId: idMatch ? idMatch[1] : null })
      }
    }

    return { resultCount: listings.length, listings }
  })
}

async function getListing(page: Page, params: Record<string, unknown>, errors: AdapterErrors): Promise<unknown> {
  const city = (params.city as string) || 'sfbay'
  const category = params.category as string
  const slug = params.slug as string
  const id = params.id as string
  await navigateTo(page, city, `/${category}/d/${slug}/${id}.html`, errors)

  return page.evaluate(() => {
    // Title
    const titleEl = document.querySelector('.postingtitletext, #titletextonly')
    const title = titleEl?.textContent?.replace(/\$[\d,]+/, '')?.trim() || document.querySelector('title')?.textContent?.trim() || ''

    // Price
    const priceEl = document.querySelector('.postingtitletext .price, .price')
    const price = priceEl?.textContent?.trim() || null

    // Body
    const bodyEl = document.getElementById('postingbody')
    let body = ''
    if (bodyEl) {
      // Remove the "QR Code Link to This Post" notice
      const clone = bodyEl.cloneNode(true) as HTMLElement
      const notices = clone.querySelectorAll('.print-information, .print-qrcode-container')
      for (const n of notices) n.remove()
      body = clone.textContent?.trim() || ''
    }

    // Location
    const mapAddr = document.querySelector('.mapaddress')
    const location = mapAddr?.textContent?.trim() || null

    // Coordinates
    const mapEl = document.getElementById('map')
    const latitude = mapEl ? Number(mapEl.getAttribute('data-latitude')) || null : null
    const longitude = mapEl ? Number(mapEl.getAttribute('data-longitude')) || null : null

    // Timestamps
    const timeEls = document.querySelectorAll('.postinginfos time')
    let postedAt: string | null = null
    let updatedAt: string | null = null
    for (const t of timeEls) {
      const dt = t.getAttribute('datetime')
      const parent = t.parentElement?.textContent || ''
      if (parent.includes('posted') && dt) postedAt = dt
      if (parent.includes('updated') && dt) updatedAt = dt
    }

    // Attributes
    const attrEls = document.querySelectorAll('.attrgroup span')
    const attributes: string[] = []
    for (const el of attrEls) {
      const text = el.textContent?.trim()
      if (text) attributes.push(text)
    }

    // Images
    const imgEls = document.querySelectorAll('#thumbs a, .gallery a, .swipe .slide img')
    const images: string[] = []
    for (const el of imgEls) {
      const href = el.getAttribute('href') || (el as HTMLImageElement).src || ''
      if (href && !images.includes(href)) images.push(href)
    }

    return {
      title,
      price,
      body,
      location,
      latitude,
      longitude,
      postedAt,
      updatedAt,
      attributes,
      images,
      url: window.location.href,
    }
  })
}

async function getCategories(page: Page, params: Record<string, unknown>, errors: AdapterErrors): Promise<unknown> {
  const city = (params.city as string) || 'sfbay'
  await navigateTo(page, city, '/', errors)

  return page.evaluate(() => {
    const categories: { name: string; code: string; section: string | null }[] = []

    // Strategy 1: category links in the left sidebar / main content
    const links = document.querySelectorAll('a[href*="/search/"]')
    let currentSection: string | null = null

    for (const link of links) {
      const href = link.getAttribute('href') || ''
      const codeMatch = href.match(/\/search\/(\w+)/)
      if (!codeMatch) continue
      const code = codeMatch[1]
      const name = link.textContent?.trim() || ''
      if (!name || !code) continue

      // Try to find the section heading
      const parent = link.closest('.community, .housing, .jobs, .for-sale, .services, .gigs, .resumes, .discussion, .cl-left-column li, ul, div')
      const heading = parent?.closest('div, section')?.querySelector('h4, h5, .cl-header, .community-cat-header')
      if (heading) currentSection = heading.textContent?.trim() || currentSection

      // Deduplicate
      if (!categories.some((c) => c.code === code)) {
        categories.push({ name, code, section: currentSection })
      }
    }

    return { city: window.location.hostname.replace('.craigslist.org', ''), categories }
  })
}

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, errors: AdapterErrors) => Promise<unknown>> = {
  searchListings,
  getListing,
  getCategories,
}

const adapter: CustomRunner = {
  name: 'craigslist-dom',
  description: 'Craigslist — classifieds search, listing details, categories via DOM extraction',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const { errors } = helpers as unknown as { errors: AdapterErrors }
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw errors.unknownOp(operation)
      return await handler(page as Page, { ...params }, errors)
    } catch (error) {
      throw errors.wrap(error)
    }
  },
}

export default adapter
