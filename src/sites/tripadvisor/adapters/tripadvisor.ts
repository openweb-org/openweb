import type { Page } from 'playwright-core'

interface CodeAdapter {
  readonly name: string
  readonly description: string
  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown>
}

const TA_ORIGIN = 'https://www.tripadvisor.com'

async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 20_000 })
  await page.waitForSelector('script[type="application/ld+json"]', { timeout: 10_000 }).catch(() => {})
}

function parseAddress(addr: Record<string, unknown> | null) {
  if (!addr) return null
  const country = addr.addressCountry
  return {
    street: (addr.streetAddress as string) ?? null,
    city: (addr.addressLocality as string) ?? null,
    region: (addr.addressRegion as string) ?? null,
    country: typeof country === 'object' && country ? (country as Record<string, unknown>).name as string ?? null : (country as string) ?? null,
    postalCode: (addr.postalCode as string) ?? null,
  }
}

/* ---------- searchLocation ---------- */

async function searchLocation(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const query = String(params.query ?? '')
  if (!query) throw new Error('query is required')

  await page.goto(`${TA_ORIGIN}/`, { waitUntil: 'load', timeout: 20_000 })
  await page.waitForTimeout(1_000)

  const input = await page.waitForSelector(
    'input[type="search"], input[placeholder*="search" i], input[placeholder*="where" i], input[aria-label*="search" i]',
    { timeout: 5_000 },
  )
  await input.click()
  await input.fill(query)
  await page.waitForTimeout(3_000)

  return page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="-g"]')
    const results: Array<Record<string, unknown>> = []
    const seen = new Set<string>()

    for (const link of links) {
      const href = (link as HTMLAnchorElement).href || ''
      const geoMatch = href.match(/-g(\d+)-/)
      if (!geoMatch) continue
      const geoId = geoMatch[1]
      const text = link.textContent?.trim() || ''
      if (!text || text.length < 3) continue

      // Only keep Tourism (location) links as the primary result, plus Hotels/Restaurants/Attractions
      let type = 'other'
      let locationSlug: string | null = null
      if (href.includes('/Tourism-')) {
        type = 'location'
        const m = href.match(/Tourism-g\d+-(.+?)-Vacations/)
        locationSlug = m?.[1] ?? null
      } else if (href.includes('/Hotels-')) {
        type = 'hotels'
        const m = href.match(/Hotels-g\d+-(.+?)-Hotels/)
        locationSlug = m?.[1] ?? null
      } else if (href.includes('/Restaurants-')) {
        type = 'restaurants'
        const m = href.match(/Restaurants-g\d+-(.+?)\.html/)
        locationSlug = m?.[1] ?? null
      } else if (href.includes('/Attractions-')) {
        type = 'attractions'
        const m = href.match(/Attractions-g\d+-Activities-(.+?)\.html/)
        locationSlug = m?.[1] ?? null
      } else {
        continue // skip product/review links
      }

      const key = `${geoId}:${type}`
      if (seen.has(key)) continue
      seen.add(key)

      results.push({ geoId, name: text.substring(0, 120), type, locationSlug, url: href })
    }

    return { count: results.length, results }
  })
}

/* ---------- searchHotels ---------- */

async function searchHotels(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const geoId = String(params.geoId ?? '')
  const location = String(params.location ?? '')
  if (!geoId || !location) throw new Error('geoId and location are required')

  const url = `${TA_ORIGIN}/Hotels-g${geoId}-${location}-Hotels.html`
  await navigateTo(page, url)

  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] !== 'ItemList') continue

        const items = (data.itemListElement ?? []) as Array<Record<string, unknown>>
        const hotels = items.map((li) => {
          const item = (li.item ?? {}) as Record<string, unknown>
          const addr = item.address as Record<string, unknown> | null
          const agg = item.aggregateRating as Record<string, unknown> | null
          const addrCountry = addr?.addressCountry

          return {
            name: (item.name as string) ?? null,
            url: (item.url as string) ?? null,
            rating: agg?.ratingValue ?? null,
            reviewCount: agg?.reviewCount ?? null,
            priceRange: (item.priceRange as string) ?? null,
            address: addr
              ? {
                  street: (addr.streetAddress as string) ?? null,
                  city: (addr.addressLocality as string) ?? null,
                  region: (addr.addressRegion as string) ?? null,
                  country: typeof addrCountry === 'object' && addrCountry
                    ? (addrCountry as Record<string, unknown>).name ?? null
                    : addrCountry ?? null,
                  postalCode: (addr.postalCode as string) ?? null,
                }
              : null,
            telephone: (item.telephone as string) ?? null,
            image: (item.image as string) ?? null,
          }
        })

        return { count: hotels.length, hotels }
      } catch { /* skip malformed */ }
    }
    return { count: 0, hotels: [] }
  })
}

/* ---------- getRestaurant ---------- */

async function getRestaurant(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const geoId = String(params.geoId ?? '')
  const locationId = String(params.locationId ?? '')
  const slug = String(params.slug ?? '')
  if (!geoId || !locationId || !slug) throw new Error('geoId, locationId, and slug are required')

  const url = `${TA_ORIGIN}/Restaurant_Review-g${geoId}-d${locationId}-Reviews-${slug}.html`
  await navigateTo(page, url)

  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] !== 'FoodEstablishment' && data['@type'] !== 'Restaurant') continue

        const addr = data.address as Record<string, unknown> | null
        const agg = data.aggregateRating as Record<string, unknown> | null
        const hours = (data.openingHoursSpecification ?? []) as Array<Record<string, unknown>>
        const addrCountry = addr?.addressCountry

        return {
          name: data.name ?? null,
          url: data.url ?? null,
          cuisine: data.servesCuisine ?? [],
          rating: agg?.ratingValue ?? null,
          reviewCount: agg?.reviewCount ?? null,
          priceRange: data.priceRange ?? null,
          telephone: data.telephone ?? null,
          menuUrl: data.hasMenu ?? null,
          address: addr
            ? {
                street: (addr.streetAddress as string) ?? null,
                city: (addr.addressLocality as string) ?? null,
                region: (addr.addressRegion as string) ?? null,
                country: typeof addrCountry === 'object' && addrCountry
                  ? (addrCountry as Record<string, unknown>).name ?? null
                  : addrCountry ?? null,
                postalCode: (addr.postalCode as string) ?? null,
              }
            : null,
          openingHours: hours.map((h) => ({
            day: (h.dayOfWeek as string) ?? null,
            opens: (h.opens as string) ?? null,
            closes: (h.closes as string) ?? null,
          })),
          image: data.image ?? null,
        }
      } catch { /* skip malformed */ }
    }
    return null
  })
}

/* ---------- getAttractionReviews ---------- */

async function getAttractionReviews(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const geoId = String(params.geoId ?? '')
  const locationId = String(params.locationId ?? '')
  const slug = String(params.slug ?? '')
  if (!geoId || !locationId || !slug) throw new Error('geoId, locationId, and slug are required')

  const url = `${TA_ORIGIN}/Attraction_Review-g${geoId}-d${locationId}-Reviews-${slug}.html`
  await navigateTo(page, url)
  // Wait for review cards to render
  await page.waitForSelector('[data-automation="reviewCard"]', { timeout: 8_000 }).catch(() => {})

  return page.evaluate(() => {
    // Extract attraction info from LD+JSON
    let attraction: Record<string, unknown> = {}
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] === 'LocalBusiness' || data['@type'] === 'TouristAttraction') {
          const addr = data.address as Record<string, unknown> | null
          const agg = data.aggregateRating as Record<string, unknown> | null
          attraction = {
            name: data.name ?? null,
            rating: agg?.ratingValue != null ? Number(agg.ratingValue) : null,
            reviewCount: agg?.reviewCount != null ? Number(agg.reviewCount) : null,
            address: addr
              ? {
                  street: addr.streetAddress ?? null,
                  city: addr.addressLocality ?? null,
                  region: addr.addressRegion ?? null,
                  country: typeof addr.addressCountry === 'object' && addr.addressCountry
                    ? (addr.addressCountry as Record<string, unknown>).name ?? null
                    : addr.addressCountry ?? null,
                  postalCode: addr.postalCode ?? null,
                }
              : null,
            telephone: data.telephone ?? null,
            image: data.image ?? null,
          }
          break
        }
      } catch { /* skip malformed */ }
    }

    // Extract reviews from DOM
    const cards = document.querySelectorAll('[data-automation="reviewCard"]')
    const reviews: Array<Record<string, unknown>> = []

    for (const card of cards) {
      const titleEl = card.querySelector('a[href*="Review"] span, [data-automation="reviewTitle"]')
      const title = titleEl?.textContent?.trim() ?? null

      // Find longest text span as review body
      const spans = card.querySelectorAll('span')
      let text: string | null = null
      for (const span of spans) {
        const t = span.textContent?.trim() ?? ''
        if (t.length > 30 && (!text || t.length > text.length)) text = t
      }

      const dateMatch = card.textContent?.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/)

      reviews.push({
        title,
        text: text ? text.substring(0, 500) : null,
        date: dateMatch?.[1] ?? null,
      })
    }

    return { ...attraction, reviews }
  })
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Readonly<Record<string, unknown>>) => Promise<unknown>> = {
  searchLocation,
  searchHotels,
  getRestaurant,
  getAttractionReviews,
}

const adapter: CodeAdapter = {
  name: 'tripadvisor',
  description: 'TripAdvisor LD+JSON + DOM extraction — hotels, restaurants, attraction reviews',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('tripadvisor.com') || url === 'about:blank'
  },

  async isAuthenticated(): Promise<boolean> {
    return true // public data, no auth required
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) {
      throw new Error(`Unknown operation: ${operation}. Available: ${Object.keys(OPERATIONS).join(', ')}`)
    }
    return handler(page, params)
  },
}

export default adapter
