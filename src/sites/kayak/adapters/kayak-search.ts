import type { Page, Response as PwResponse } from 'patchright'
/**
 * Kayak L3 adapter — mixed intercept + extraction.
 *
 * Flights & Cars: intercept progressive poll API responses.
 * Hotels: DOM extraction from SSR map view (poll API doesn't fire on clean sessions).
 *
 * Poll endpoints (flights/cars):
 *   Flights: POST /i/api/search/dynamic/flights/poll
 *   Cars:    POST /i/api/search/v1/cars/poll
 */

/* ---------- types ---------- */

type ErrorHelpers = {
  unknownOp(op: string): Error
  httpError(status: number): Error
  apiError(label: string, msg: string): Error
}

/* ---------- shared intercept ---------- */

/**
 * Navigate to a Kayak search URL and intercept the progressive poll responses.
 * Returns the most complete poll response (highest result count).
 */
async function interceptPoll(
  page: Page,
  navigateUrl: string,
  pollUrlMatch: string,
  timeout = 30_000,
): Promise<Record<string, unknown> | null> {
  let best: Record<string, unknown> | null = null
  let bestCount = 0

  const handler = async (resp: PwResponse) => {
    if (!resp.url().includes(pollUrlMatch)) return
    if (resp.status() !== 200) return
    try {
      const body = await resp.body()
      const json = JSON.parse(body.toString()) as Record<string, unknown>
      const results = json.results as unknown[] | undefined
      const count = Array.isArray(results) ? results.length : 0
      if (count > bestCount) {
        best = json
        bestCount = count
      }
    } catch { /* ignore parse errors on partial responses */ }
  }

  page.on('response', handler)
  try {
    await page.goto(navigateUrl, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1000))
      // Stop early if we have results and status indicates completion
      if (best) {
        const status = best.status as string | undefined
        const searchStatus = best.searchStatus as string | undefined
        if (status === 'complete' || status === 'completed' || searchStatus === 'complete') break
      }
    }
  } finally {
    page.off('response', handler)
  }

  return best
}

/* ---------- operation handlers ---------- */

async function searchFlights(
  page: Page,
  params: Record<string, unknown>,
  errors: ErrorHelpers,
): Promise<unknown> {
  const origin = String(params.origin ?? 'SFO')
  const destination = String(params.destination ?? 'LAX')
  const departureDate = String(params.departureDate ?? params.departure)
  const returnDate = params.returnDate ?? params.return
  const adults = Number(params.adults ?? 1)
  const cabinClass = String(params.cabinClass ?? 'economy')
  const sort = String(params.sort ?? 'bestflight_a')

  if (!departureDate) throw errors.apiError('searchFlights', 'departureDate is required')

  // Build Kayak flight search URL
  let url = `https://www.kayak.com/flights/${origin}-${destination}/${departureDate}`
  if (returnDate) url += `/${returnDate}`
  url += `?sort=${sort}`
  if (adults > 1) url += `&adults=${adults}`
  if (cabinClass !== 'economy') url += `&cabin=${cabinClass}`

  const data = await interceptPoll(page, url, '/search/dynamic/flights/poll')
  if (!data) {
    throw errors.apiError('searchFlights', 'No flight results captured — search may have timed out or been blocked')
  }

  return data
}

async function searchHotels(
  page: Page,
  params: Record<string, unknown>,
  errors: ErrorHelpers,
): Promise<unknown> {
  const destination = String(params.destination ?? params.location ?? 'New-York')
  const checkInDate = String(params.checkInDate ?? params.checkIn)
  const checkOutDate = String(params.checkOutDate ?? params.checkOut)
  const guests = Number(params.guests ?? params.adults ?? 2)
  const rooms = Number(params.rooms ?? 1)
  const sort = String(params.sort ?? 'rank_a')

  if (!checkInDate || !checkOutDate) {
    throw errors.apiError('searchHotels', 'checkInDate and checkOutDate are required')
  }

  // Kayak hotel URL → SSR map view with hotel cards in DOM
  const location = destination.replace(/\s+/g, '-')
  let url = `https://www.kayak.com/hotels/${location}/${checkInDate}/${checkOutDate}/${guests}adults`
  if (rooms > 1) url += `/${rooms}rooms`
  url += `?sort=${sort}`

  await page.goto(url, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
  await page.waitForSelector('[class*="resultInner"]', { timeout: 20_000 }).catch(() => {})

  // Extract hotel data from SSR-rendered DOM
  const results = await page.evaluate(() => {
    const cards = document.querySelectorAll('[class*="resultInner"]')
    return Array.from(cards).map(card => {
      const text = card.innerText
      const lines = text.split('\n').filter(l => l.trim().length > 0)

      // Name: first substantial line (skip Save, Share, Compare)
      let name = ''
      for (const l of lines) {
        const t = l.trim()
        if (t.length > 5 && !['Save', 'Share', 'Compare'].includes(t)) { name = t; break }
      }

      // Rating: pattern like "8.4" followed by text and review count
      const ratingMatch = text.match(/(\d+\.\d)\s+(\w[\w\s]*?)\((\d[\d,]*)\)/)
      const starsMatch = text.match(/(\d)\s*stars?/i)
      const priceMatch = text.match(/\$(\d[\d,]+)/)

      // Location from name link
      const nameLink = card.querySelector('[class*="FLpo-hotel-name"] a, [class*="hotel-name"] a, a[class*="name"]')
      const linkHref = nameLink?.getAttribute('href') ?? ''

      return {
        name,
        rating: ratingMatch ? Number(ratingMatch[1]) : null,
        ratingText: ratingMatch ? ratingMatch[2].trim() : null,
        reviews: ratingMatch ? Number(ratingMatch[3].replace(/,/g, '')) : null,
        stars: starsMatch ? Number(starsMatch[1]) : null,
        price: priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null,
        detailUrl: linkHref || null,
      }
    })
  })

  if (results.length === 0) {
    throw errors.apiError('searchHotels', 'No hotel results found — page may not have loaded or location not recognized')
  }

  return {
    searchUrl: page.url(),
    totalCount: results.length,
    results,
  }
}

async function searchCars(
  page: Page,
  params: Record<string, unknown>,
  errors: ErrorHelpers,
): Promise<unknown> {
  const location = String(params.location ?? params.pickupLocation ?? 'LAX')
  const pickupDate = String(params.pickupDate ?? params.startDate)
  const dropoffDate = String(params.dropoffDate ?? params.endDate)
  const sort = String(params.sort ?? 'rank_a')

  if (!pickupDate || !dropoffDate) {
    throw errors.apiError('searchCars', 'pickupDate and dropoffDate are required')
  }

  const loc = location.replace(/\s+/g, '-')
  let url = `https://www.kayak.com/cars/${loc}/${pickupDate}/${dropoffDate}`
  url += `?sort=${sort}`

  const data = await interceptPoll(page, url, '/api/search/v1/cars/poll')
  if (!data) {
    throw errors.apiError('searchCars', 'No car results captured — search may have timed out or been blocked')
  }

  return data
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<
  string,
  (page: Page, params: Record<string, unknown>, errors: ErrorHelpers) => Promise<unknown>
> = {
  searchFlights,
  searchHotels,
  searchCars,
}

const adapter = {
  name: 'kayak-search',
  description: 'Kayak search — flights, hotels, cars via poll interception',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('kayak.com')
  },

  async isAuthenticated(): Promise<boolean> {
    return false // Public search, no auth required
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { errors } = helpers as { errors: ErrorHelpers }
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page, { ...params }, errors)
  },
}

export default adapter
