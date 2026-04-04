import type { Page } from 'playwright-core'

interface CodeAdapter {
  readonly name: string
  readonly description: string
  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown>
}

const TA_ORIGIN = 'https://www.tripadvisor.com'

async function isDataDomeBlocked(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.body?.innerHTML?.includes('captcha-delivery.com') ?? false,
  )
}

function dataDomeError(): Error {
  return new Error('DataDome captcha blocked this request. Solve the captcha in the browser, then retry.')
}

async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 20_000 })
  await page.waitForSelector(
    'script[type="application/ld+json"], h1, [data-test-target]',
    { timeout: 10_000 },
  ).catch(() => {})
  if (await isDataDomeBlocked(page)) throw dataDomeError()
}

/* ---------- searchLocation ---------- */

async function searchLocation(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const query = String(params.query ?? '')
  if (!query) throw new Error('query is required')

  // Use /Search URL directly — avoids fragile homepage input selectors
  await page.goto(`${TA_ORIGIN}/Search?q=${encodeURIComponent(query)}&ssrc=a&geo=1`, {
    waitUntil: 'load', timeout: 20_000,
  })
  await page.waitForTimeout(3_000)
  if (await isDataDomeBlocked(page)) throw dataDomeError()

  return page.evaluate(() => {
    const results: Array<Record<string, unknown>> = []
    const seen = new Set<string>()
    const patterns: [string, string, RegExp | null][] = [
      ['/Tourism-', 'location', /Tourism-g\d+-(.+?)-Vacations/],
      ['/Hotels-', 'hotels', /Hotels-g\d+-(.+?)-Hotels/],
      ['/Restaurants-', 'restaurants', /Restaurants-g\d+-(.+?)\.html/],
      ['/Attractions-', 'attractions', /Attractions-g\d+-Activities-(.+?)\.html/],
      ['/Hotel_Review-', 'hotels', null],
      ['/Restaurant_Review-', 'restaurants', null],
      ['/Attraction_Review-', 'attractions', null],
    ]
    for (const link of document.querySelectorAll('a[href*="-g"]')) {
      const href = (link as HTMLAnchorElement).href || ''
      const geoId = href.match(/-g(\d+)-/)?.[1]
      if (!geoId) continue
      const text = link.textContent?.trim() || ''
      if (text.length < 3) continue

      let matched = false
      for (const [frag, type, re] of patterns) {
        if (!href.includes(frag)) continue
        const key = `${geoId}:${type}`
        if (seen.has(key)) { matched = true; break }
        seen.add(key)
        const slug = re ? href.match(re)?.[1] ?? null : null
        results.push({ geoId, name: text.substring(0, 120), type, locationSlug: slug, url: href })
        matched = true
        break
      }
      if (!matched) continue
    }
    return { count: results.length, results }
  })
}

/* ---------- searchHotels ---------- */

async function searchHotels(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const geoId = String(params.geoId ?? '')
  const location = String(params.location ?? '')
  if (!geoId || !location) throw new Error('geoId and location are required')

  await navigateTo(page, `${TA_ORIGIN}/Hotels-g${geoId}-${location}-Hotels.html`)

  return page.evaluate(() => {
    function addr(a: Record<string, unknown> | null) {
      if (!a) return null
      const c = a.addressCountry
      return {
        street: (a.streetAddress as string) ?? null,
        city: (a.addressLocality as string) ?? null,
        region: (a.addressRegion as string) ?? null,
        country: typeof c === 'object' && c ? (c as Record<string, unknown>).name ?? null : c ?? null,
        postalCode: (a.postalCode as string) ?? null,
      }
    }
    function hotelFrom(item: Record<string, unknown>) {
      const agg = item.aggregateRating as Record<string, unknown> | null
      return {
        name: (item.name as string) ?? null, url: (item.url as string) ?? null,
        rating: agg?.ratingValue ?? null, reviewCount: agg?.reviewCount ?? null,
        priceRange: (item.priceRange as string) ?? null,
        address: addr(item.address as Record<string, unknown> | null),
        telephone: (item.telephone as string) ?? null, image: (item.image as string) ?? null,
      }
    }
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')

    // Strategy 1: LD+JSON ItemList
    for (const s of scripts) {
      try {
        const d = JSON.parse(s.textContent ?? '')
        if (d['@type'] !== 'ItemList') continue
        const hotels = ((d.itemListElement ?? []) as Array<Record<string, unknown>>)
          .map(li => hotelFrom((li.item ?? li) as Record<string, unknown>))
        return { count: hotels.length, hotels }
      } catch { /* skip */ }
    }
    // Strategy 2: Individual Hotel/LodgingBusiness LD+JSON blocks
    const hotelTypes = new Set(['Hotel', 'LodgingBusiness', 'Hostel', 'Motel', 'BedAndBreakfast', 'Resort'])
    const hotels: ReturnType<typeof hotelFrom>[] = []
    for (const s of scripts) {
      try {
        const d = JSON.parse(s.textContent ?? '')
        const t = d['@type']
        const types: string[] = Array.isArray(t) ? t : [t]
        if (types.some(x => hotelTypes.has(x))) hotels.push(hotelFrom(d))
      } catch { /* skip */ }
    }
    if (hotels.length) return { count: hotels.length, hotels }

    // Strategy 3: DOM fallback — hotel card links
    const domHotels: { name: string; url: string | null }[] = []
    for (const card of document.querySelectorAll(
      'div[data-automation="hotel-card-title"], span.listItem, [data-testid*="hotel"]',
    )) {
      const a = card.querySelector('a[href*="Hotel_Review"]') ?? card.closest('a[href*="Hotel_Review"]')
      if (!a) continue
      const name = a.textContent?.trim() || card.textContent?.trim() || ''
      if (name) domHotels.push({ name: name.substring(0, 120), url: (a as HTMLAnchorElement).href || null })
    }
    if (domHotels.length) return { count: domHotels.length, hotels: domHotels }
    return { count: 0, hotels: [] }
  })
}

/* ---------- getRestaurant ---------- */

async function getRestaurant(page: Page, params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const geoId = String(params.geoId ?? '')
  const locationId = String(params.locationId ?? '')
  const slug = String(params.slug ?? '')
  if (!geoId || !locationId || !slug) throw new Error('geoId, locationId, and slug are required')

  await navigateTo(page, `${TA_ORIGIN}/Restaurant_Review-g${geoId}-d${locationId}-Reviews-${slug}.html`)

  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    const restTypes = new Set(['Restaurant', 'FoodEstablishment', 'BarOrPub', 'CafeOrCoffeeShop', 'FastFoodRestaurant', 'LocalBusiness'])

    function parse(data: Record<string, unknown>) {
      const a = data.address as Record<string, unknown> | null
      const c = a?.addressCountry
      const agg = data.aggregateRating as Record<string, unknown> | null
      const hours = (data.openingHoursSpecification ?? []) as Array<Record<string, unknown>>
      return {
        name: data.name ?? null, url: data.url ?? null, cuisine: data.servesCuisine ?? [],
        rating: agg?.ratingValue ?? null, reviewCount: agg?.reviewCount ?? null,
        priceRange: data.priceRange ?? null, telephone: data.telephone ?? null,
        menuUrl: data.hasMenu ?? data.menu ?? null,
        address: a ? {
          street: (a.streetAddress as string) ?? null, city: (a.addressLocality as string) ?? null,
          region: (a.addressRegion as string) ?? null,
          country: typeof c === 'object' && c ? (c as Record<string, unknown>).name ?? null : c ?? null,
          postalCode: (a.postalCode as string) ?? null,
        } : null,
        openingHours: hours.map(h => ({
          day: (h.dayOfWeek as string) ?? null, opens: (h.opens as string) ?? null, closes: (h.closes as string) ?? null,
        })),
        image: data.image ?? null,
      }
    }

    // Match by @type
    for (const s of scripts) {
      try {
        const d = JSON.parse(s.textContent ?? '')
        const t = d['@type']
        const types: string[] = Array.isArray(t) ? t : [t]
        if (types.some(x => restTypes.has(x))) return parse(d)
      } catch { /* skip */ }
    }
    // Fallback: any LD+JSON with aggregateRating on this page
    for (const s of scripts) {
      try {
        const d = JSON.parse(s.textContent ?? '')
        if (d.aggregateRating && d.name) return parse(d)
      } catch { /* skip */ }
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

  await navigateTo(page, `${TA_ORIGIN}/Attraction_Review-g${geoId}-d${locationId}-Reviews-${slug}.html`)
  await page.waitForSelector(
    '[data-test-target="review-title"], [data-automation="reviewCard"], [data-reviewid]',
    { timeout: 8_000 },
  ).catch(() => {})

  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    const attrTypes = new Set(['LocalBusiness', 'TouristAttraction', 'LandmarksOrHistoricalBuildings', 'Place', 'CivicStructure', 'Museum', 'Park'])

    // Attraction info from LD+JSON
    let attraction: Record<string, unknown> = {}
    for (const s of scripts) {
      try {
        const d = JSON.parse(s.textContent ?? '')
        const t = d['@type']
        const types: string[] = Array.isArray(t) ? t : [t]
        const isMatch = types.some(x => attrTypes.has(x)) || (!attraction.name && d.aggregateRating && d.name)
        if (!isMatch) continue
        const a = d.address as Record<string, unknown> | null
        const c = a?.addressCountry
        const agg = d.aggregateRating as Record<string, unknown> | null
        attraction = {
          name: d.name ?? null,
          rating: agg?.ratingValue != null ? Number(agg.ratingValue) : null,
          reviewCount: agg?.reviewCount != null ? Number(agg.reviewCount) : null,
          address: a ? {
            street: a.streetAddress ?? null, city: a.addressLocality ?? null,
            region: a.addressRegion ?? null,
            country: typeof c === 'object' && c ? (c as Record<string, unknown>).name ?? null : c ?? null,
            postalCode: a.postalCode ?? null,
          } : null,
          telephone: d.telephone ?? null, image: d.image ?? null,
        }
        break
      } catch { /* skip */ }
    }

    // Reviews from DOM — tiered selectors
    function parseReview(el: Element) {
      const titleEl = el.querySelector(
        '[data-test-target="review-title"] span, a[href*="Review"] span, [data-automation="reviewTitle"]',
      )
      const textEl = el.querySelector('[data-automation*="reviewText"] span, [data-automation*="reviewText"]')
      let text = textEl?.textContent?.trim() ?? null
      if (!text) {
        for (const span of el.querySelectorAll('span')) {
          const t = span.textContent?.trim() ?? ''
          if (t.length > 30 && (!text || t.length > text.length)) text = t
        }
      }
      const dateMatch = el.textContent?.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/)
      const ratingEl = el.querySelector('[class*="ui_bubble_rating"], [data-test-target="review-rating"] span')
      let rating: number | null = null
      if (ratingEl) {
        const m = (ratingEl.className || '').match(/bubble_(\d)/)
        if (m) rating = Number(m[1])
      }
      return {
        title: titleEl?.textContent?.trim() ?? null,
        text: text ? text.substring(0, 500) : null,
        date: dateMatch?.[1] ?? null,
        ...(rating != null ? { rating } : {}),
      }
    }

    let reviewEls = document.querySelectorAll('[data-reviewid]')
    if (!reviewEls.length) reviewEls = document.querySelectorAll('[data-automation="reviewCard"]')

    const reviews: ReturnType<typeof parseReview>[] = []
    if (reviewEls.length) {
      for (const card of reviewEls) reviews.push(parseReview(card))
    } else {
      // Strategy 3: walk up from review-title elements
      for (const titleEl of document.querySelectorAll('[data-test-target="review-title"]')) {
        const container = titleEl.closest('[class*="review"]') ?? titleEl.parentElement?.parentElement?.parentElement
        if (container) reviews.push(parseReview(container))
      }
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
    return true
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
