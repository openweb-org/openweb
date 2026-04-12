import type { Page } from 'patchright'

/**
 * Airbnb adapter — Node fetch API + HTML SSR extraction.
 *
 * Reviews and availability: direct GraphQL API calls (node fetch, zero browser).
 * Search and listing detail: node HTML fetch + SSR parsing (#data-deferred-state-0).
 * Host profile: browser page navigation + SSR extraction (bot detection blocks node).
 */

type AdapterErrors = {
  unknownOp(op: string): Error
  wrap(error: unknown): Error
}

/* ---------- constants ---------- */

const API_KEY = 'd306zoyjsyarp7ifhu67rjxn52tv0t20'
const API_BASE = 'https://www.airbnb.com/api/v3'

const HASHES = {
  reviews: '2ed951bfedf71b87d9d30e24a419e15517af9fbed7ac560a8d1cc7feadfa22e6',
  calendar: 'b23335819df0dc391a338d665e2ee2f5d3bff19181d05c0b39bc6c5aac403914',
}

const NODE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
}

const GQL_HEADERS: Record<string, string> = {
  ...NODE_HEADERS,
  'X-Airbnb-API-Key': API_KEY,
  'X-Airbnb-GraphQL-Platform-Client': 'minimalist-niobe',
  'X-Airbnb-GraphQL-Platform': 'web',
  'Content-Type': 'application/json',
}

/* ---------- SSR parsing ---------- */

/** Parse presentation object from Airbnb's SSR HTML (#data-deferred-state-0). */
function parsePresentation(html: string): Record<string, unknown> | null {
  const match = html.match(/<script\s+id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) return null
  try {
    const data = JSON.parse(match[1])
    const client = data?.niobeClientData
    if (!Array.isArray(client)) return null
    for (const entry of client) {
      const pres = entry?.[1]?.data?.presentation
      if (pres) return pres as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/* ---------- operations ---------- */

async function searchListings(_page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
  const qp = new URLSearchParams()
  if (params.checkin) qp.set('checkin', String(params.checkin))
  if (params.checkout) qp.set('checkout', String(params.checkout))
  if (params.adults) qp.set('adults', String(params.adults))
  if (params.children) qp.set('children', String(params.children))
  if (params.infants) qp.set('infants', String(params.infants))
  if (params.price_min) qp.set('price_min', String(params.price_min))
  if (params.price_max) qp.set('price_max', String(params.price_max))
  if (params['room_types[]']) qp.set('room_types[]', String(params['room_types[]']))

  const qs = qp.toString()
  const url = `https://www.airbnb.com/s/${encodeURIComponent(query)}/homes${qs ? `?${qs}` : ''}`

  const resp = await fetch(url, {
    headers: { ...NODE_HEADERS, Accept: 'text/html,application/xhtml+xml' },
  })
  if (resp.status !== 200) throw new Error(`Search page returned ${resp.status}`)

  const html = await resp.text()
  const pres = parsePresentation(html)
  if (!pres?.staysSearch) throw new Error('Failed to extract search results from SSR')

  return (pres.staysSearch as Record<string, unknown>).results
}

async function getListingDetail(_page: Page, params: Record<string, unknown>): Promise<unknown> {
  const id = String(params.id ?? '')
  const qp = new URLSearchParams()
  if (params.check_in) qp.set('check_in', String(params.check_in))
  if (params.check_out) qp.set('check_out', String(params.check_out))
  if (params.adults) qp.set('adults', String(params.adults))

  const qs = qp.toString()
  const url = `https://www.airbnb.com/rooms/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`

  const resp = await fetch(url, {
    headers: { ...NODE_HEADERS, Accept: 'text/html,application/xhtml+xml' },
  })
  if (resp.status !== 200) throw new Error(`Listing page returned ${resp.status}`)

  const html = await resp.text()
  const pres = parsePresentation(html)
  if (!pres?.stayProductDetailPage) throw new Error('Failed to extract listing detail from SSR')

  return pres.stayProductDetailPage
}

async function getListingReviews(_page: Page, params: Record<string, unknown>): Promise<unknown> {
  const id = String(params.id ?? '')
  const listingId = Buffer.from(`StayListing:${id}`).toString('base64')

  const variables = JSON.stringify({
    id: listingId,
    pdpReviewsRequest: {
      fieldSelector: 'for_p3_translation_only',
      forPreview: false,
      limit: 24,
      offset: '0',
      showingTranslationButton: false,
      first: 24,
      sortingPreference: 'BEST_QUALITY',
    },
  })
  const extensions = JSON.stringify({
    persistedQuery: { version: 1, sha256Hash: HASHES.reviews },
  })

  const url = `${API_BASE}/StaysPdpReviewsQuery/${HASHES.reviews}?operationName=StaysPdpReviewsQuery&locale=en&currency=USD&variables=${encodeURIComponent(variables)}&extensions=${encodeURIComponent(extensions)}`

  const resp = await fetch(url, { headers: GQL_HEADERS })
  const json = (await resp.json()) as Record<string, unknown>
  const pdp = (json?.data as Record<string, unknown>)?.presentation as Record<string, unknown>
  const reviewsObj = (pdp?.stayProductDetailPage as Record<string, unknown>)?.reviews as Record<string, unknown>
  if (!reviewsObj) throw new Error('Failed to extract reviews from API response')

  const reviews = ((reviewsObj.reviews ?? []) as Array<Record<string, unknown>>).map(r => ({
    id: r.id,
    comments: r.comments ?? r.commentV2,
    rating: r.rating,
    createdAt: r.createdAt,
    localizedDate: r.localizedDate,
    reviewer: r.reviewer,
    language: r.language,
    highlightType: r.highlightType,
    reviewHighlight: r.reviewHighlight,
  }))
  const metadata = reviewsObj.metadata as Record<string, unknown> | undefined

  return {
    listingId: id,
    reviews,
    reviewsCount: metadata?.reviewsCount ?? reviews.length,
    overallRating: metadata?.overallRating ?? null,
    ratings: metadata?.ratings ?? null,
  }
}

async function getListingAvailability(_page: Page, params: Record<string, unknown>): Promise<unknown> {
  const id = String(params.id ?? '')
  const checkIn = params.check_in ? String(params.check_in) : ''
  const checkOut = params.check_out ? String(params.check_out) : ''

  const now = new Date()
  const variables = JSON.stringify({
    request: {
      count: 12,
      listingId: id,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
    },
  })
  const extensions = JSON.stringify({
    persistedQuery: { version: 1, sha256Hash: HASHES.calendar },
  })

  const url = `${API_BASE}/PdpAvailabilityCalendar/${HASHES.calendar}?operationName=PdpAvailabilityCalendar&locale=en&currency=USD&variables=${encodeURIComponent(variables)}&extensions=${encodeURIComponent(extensions)}`

  const resp = await fetch(url, { headers: GQL_HEADERS })
  const json = (await resp.json()) as Record<string, unknown>
  const merlin = (json?.data as Record<string, unknown>)?.merlin as Record<string, unknown>
  const calendar = merlin?.pdpAvailabilityCalendar as Record<string, unknown>
  if (!calendar) throw new Error('Failed to extract calendar from API response')

  const months = ((calendar.calendarMonths ?? []) as Array<Record<string, unknown>>).map(m => ({
    month: m.month,
    year: m.year,
    days: ((m.days ?? []) as Array<Record<string, unknown>>).map(d => ({
      calendarDate: d.calendarDate,
      available: d.available,
      minNights: d.minNights,
      maxNights: d.maxNights,
      availableForCheckin: d.availableForCheckin,
      availableForCheckout: d.availableForCheckout,
      price: d.price,
    })),
  }))

  return {
    listingId: id,
    checkIn: checkIn || null,
    checkOut: checkOut || null,
    calendarMonths: months,
  }
}

async function getHostProfile(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const hostId = String(params.hostId ?? '')
  const url = `https://www.airbnb.com/users/show/${encodeURIComponent(hostId)}`
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(3000)

  const presentation = await page.evaluate(() => {
    // Strategy 1: data-deferred-state tags
    for (let i = 0; i < 5; i++) {
      const el = document.querySelector(`#data-deferred-state-${i}`)
      if (!el?.textContent) continue
      try {
        const data = JSON.parse(el.textContent)
        const client = data?.niobeClientData
        if (!Array.isArray(client)) continue
        for (const entry of client) {
          const pres = entry?.[1]?.data?.presentation
          if (pres) return pres
        }
      } catch { /* continue */ }
    }
    // Strategy 2: __NEXT_DATA__
    const next = document.querySelector('#__NEXT_DATA__')
    if (next?.textContent) {
      try { return JSON.parse(next.textContent) } catch { /* continue */ }
    }
    // Strategy 3: any large application/json script
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      if ((script.textContent ?? '').length > 200) {
        try { return JSON.parse(script.textContent ?? '') } catch { /* continue */ }
      }
    }
    return null
  })

  if (!presentation) throw new Error('Failed to extract host profile data from page')
  return { hostId, profile: presentation }
}

/* ---------- dispatch ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchListings,
  getListingDetail,
  getListingReviews,
  getListingAvailability,
  getHostProfile,
}

const adapter = {
  name: 'airbnb',
  description: 'Airbnb — Node API + SSR HTML fetch. Browser only for host profile.',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('airbnb.com')
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
    const { errors } = helpers as { errors: AdapterErrors }
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    try {
      return await handler(page, { ...params })
    } catch (error) {
      throw errors.wrap(error)
    }
  },
}

export default adapter
