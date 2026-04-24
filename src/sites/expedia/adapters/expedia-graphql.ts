import type { Page, Response as PwResponse } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

const GRAPHQL_URL = 'https://www.expedia.com/graphql'

/* ---------- APQ hashes ---------- */

const HASHES = {
  PropertyListingQuery: '82abb7da6738db4c904e4d10130072236a751b5a315f6dfaf92474793597bc33',
  PropertyDetailsBasicQuery: 'd84aa742ff292a7a866582569e4ecc143ba5cdb28d11e76e0c94d65957ae972c',
} as const

/* ---------- response trimming ---------- */

const STRIP_KEYS = new Set([
  '__typename', 'analyticsEvents', 'clickstream', 'clickstreamEvents',
  'impressionAnalytics', 'intersectionAnalytics', 'renderAnalytics',
  'adaptexSuccessActionTracking', 'shoppingInvokeFunctionParams',
  'clientSideAnalytics', 'propertyListingAdaptexAnalyticsSuccessEvents',
  'tnlFields', 'dataAttributes', 'clickActionId',
  'egcsClickAnalytics', 'egcsDisplayAnalytics', 'flightsOfferAnalytics',
  'onClickAnalyticsList', 'sponsoredAirline', 'sponsoredUpsell',
  'stepIndicatorJcid', 'shoppingJoinListContainer', 'compareSection',
  'saveTripItem', 'shoppingShareLinks', 'directFeedback',
])

function trimResponse(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(trimResponse)
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (STRIP_KEYS.has(k)) continue
      out[k] = trimResponse(v)
    }
    return out
  }
  return obj
}

/* ---------- shared types ---------- */

interface DateInput {
  day: number
  month: number
  year: number
}

function buildContext(duaid: string): Record<string, unknown> {
  return {
    siteId: 1,
    locale: 'en_US',
    eapid: 0,
    tpid: 1,
    currency: 'USD',
    device: { type: 'DESKTOP' },
    identity: { duaid, authState: 'ANONYMOUS' },
    privacyTrackingState: 'CAN_TRACK',
  }
}

function parseDate(dateStr: string): DateInput {
  const [y, m, d] = dateStr.split('-').map(Number)
  return { year: y, month: m, day: d }
}

/* ---------- error helpers ---------- */

type ErrorHelpers = { unknownOp(op: string): Error; httpError(status: number): Error; apiError(label: string, msg: string): Error }

/* ---------- GraphQL fetch ---------- */

async function apqFetch(
  page: Page,
  operationName: string,
  variables: Record<string, unknown>,
  clientInfo: string,
  errors: ErrorHelpers,
): Promise<unknown> {
  const hash = HASHES[operationName as keyof typeof HASHES]
  if (!hash) {
    throw errors.unknownOp(operationName)
  }

  const body = JSON.stringify({
    operationName,
    variables,
    extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
  })

  const result = await page.evaluate(
    async (args: { url: string; body: string; clientInfo: string }) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 20_000)
      try {
        const resp = await fetch(args.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'client-info': args.clientInfo,
            'x-enable-apq': 'true',
          },
          body: args.body,
          credentials: 'same-origin',
          signal: ctrl.signal,
        })
        return { status: resp.status, text: await resp.text() }
      } finally {
        clearTimeout(timer)
      }
    },
    { url: GRAPHQL_URL, body, clientInfo },
  )

  if (result.status >= 400) {
    throw errors.httpError(result.status)
  }

  const json = JSON.parse(result.text)
  // Handle batched responses (array of results)
  const data = Array.isArray(json) ? json[0] : json
  if (data?.errors?.length) {
    const msg = data.errors[0]?.message ?? 'GraphQL error'
    throw errors.apiError(operationName, msg)
  }

  return data?.data
}

/* ---------- operation handlers ---------- */

async function searchHotels(page: Page, params: Record<string, unknown>, errors: ErrorHelpers): Promise<unknown> {
  const destination = String(params.destination ?? params.query ?? 'New York')
  const checkIn = String(params.checkInDate ?? params.checkIn ?? '2026-05-01')
  const checkOut = String(params.checkOutDate ?? params.checkOut ?? '2026-05-03')
  const adults = Number(params.adults ?? 2)
  const rooms = Number(params.rooms ?? 1)
  const regionId = params.regionId ? String(params.regionId) : null
  const offset = Number(params.offset ?? 0)
  const limit = Number(params.limit ?? 50)
  const sort = String(params.sort ?? 'RECOMMENDED')

  const duaid = await getDuaid(page)

  const variables = {
    context: buildContext(duaid),
    criteria: {
      primary: {
        dateRange: {
          checkInDate: parseDate(checkIn),
          checkOutDate: parseDate(checkOut),
        },
        destination: {
          regionName: destination,
          regionId: regionId,
          coordinates: null,
          pinnedPropertyId: null,
          propertyIds: null,
          mapBounds: null,
        },
        rooms: Array.from({ length: rooms }, () => ({ adults, children: [] })),
      },
      secondary: {
        counts: [
          { id: 'resultsStartingIndex', value: offset },
          { id: 'resultsSize', value: limit },
        ],
        booleans: [],
        selections: [
          { id: 'sort', value: sort },
          { id: 'useRewards', value: 'SHOP_WITHOUT_POINTS' },
        ],
        ranges: [],
      },
    },
    shoppingContext: { multiItem: null, queryTriggeredBy: 'OTHER' },
  }

  const data = (await apqFetch(
    page,
    'PropertyListingQuery',
    variables,
    'shopping-pwa,unknown,us-east-1',
    errors,
  )) as Record<string, unknown>
  return trimResponse(data?.propertySearch)
}

async function getHotelDetail(page: Page, params: Record<string, unknown>, errors: ErrorHelpers): Promise<unknown> {
  const propertyId = String(params.propertyId ?? params.id)
  const checkIn = String(params.checkInDate ?? params.checkIn ?? '2026-05-01')
  const checkOut = String(params.checkOutDate ?? params.checkOut ?? '2026-05-03')
  const adults = Number(params.adults ?? 2)
  const regionId = params.regionId ? String(params.regionId) : null

  const duaid = await getDuaid(page)

  const variables = {
    context: buildContext(duaid),
    propertyId,
    shoppingContext: { multiItem: null, queryTriggeredBy: 'OTHER' },
    searchCriteria: {
      primary: {
        dateRange: {
          checkInDate: parseDate(checkIn),
          checkOutDate: parseDate(checkOut),
        },
        destination: {
          regionName: '',
          regionId,
          coordinates: null,
          pinnedPropertyId: null,
          propertyIds: null,
          mapBounds: null,
        },
        rooms: [{ adults, children: [] }],
      },
      secondary: { counts: [], booleans: [], selections: [], ranges: [] },
    },
  }

  const data = (await apqFetch(page, 'PropertyDetailsBasicQuery', variables, 'shopping-pwa,unknown,us-east-1', errors)) as Record<
    string,
    unknown
  >
  return trimResponse(data?.propertyInfo)
}

async function searchFlights(page: Page, params: Record<string, unknown>, errors: ErrorHelpers): Promise<unknown> {
  const origin = String(params.origin ?? params.from ?? 'New York (NYC-All Airports)')
  const destination = String(params.destination ?? params.to ?? 'Los Angeles (LAX-Los Angeles Intl.)')
  const departureDate = String(params.departureDate ?? params.departure ?? '2026-05-10')
  const returnDate = params.returnDate ?? params.return
  const cabinClass = String(params.cabinClass ?? 'COACH').toLowerCase()
  const adults = Number(params.adults ?? 1)

  const leg1 = `from:${encodeURIComponent(origin)},to:${encodeURIComponent(destination)},departure:${departureDate}TANYT`
  let url = `https://www.expedia.com/Flights-Search?leg1=${leg1}&passengers=adults:${adults}&options=cabinclass:${cabinClass}&mode=search`

  if (returnDate) {
    const leg2 = `from:${encodeURIComponent(destination)},to:${encodeURIComponent(origin)},departure:${String(returnDate)}TANYT`
    url += `&leg2=${leg2}`
  }

  let captured: unknown = null
  const handler = async (resp: PwResponse) => {
    if (captured) return
    try {
      const req = resp.request()
      if (!req.url().includes('/graphql') || req.method() !== 'POST') return
      const postData = req.postData() ?? ''
      if (!postData.includes('Flight')) return
      const json = await resp.json()
      const entries = Array.isArray(json) ? json : [json]
      for (const entry of entries) {
        const search = entry?.data?.flightsSearch
        if (search?.listingResult) {
          captured = search
          return
        }
      }
    } catch { /* ignore parse errors */ }
  }

  page.on('response', handler)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {})
    const deadline = Date.now() + 30_000
    while (!captured && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500))
    }
  } finally {
    page.off('response', handler)
  }

  if (!captured) {
    throw errors.apiError('searchFlights', 'No flight data captured — page may not have loaded results')
  }

  const result = trimResponse(captured) as Record<string, unknown>
  const listings = (result?.listingResult as Record<string, unknown>)?.listings
  if (Array.isArray(listings)) {
    for (const listing of listings) {
      const journeys = (listing as Record<string, unknown>)?.journeys
      if (Array.isArray(journeys)) {
        for (const j of journeys) {
          delete (j as Record<string, unknown>).detailsAndFares
          delete (j as Record<string, unknown>).dialogSheet
        }
      }
    }
  }
  return result
}

async function getFlightDetail(page: Page, params: Record<string, unknown>, errors: ErrorHelpers): Promise<unknown> {
  return searchFlights(page, params, errors)
}

async function getHotelPrices(page: Page, params: Record<string, unknown>, errors: ErrorHelpers): Promise<unknown> {
  const propertyId = String(params.propertyId ?? params.id)
  const checkIn = String(params.checkInDate ?? params.checkIn ?? '2026-05-01')
  const checkOut = String(params.checkOutDate ?? params.checkOut ?? '2026-05-03')
  const adults = Number(params.adults ?? 2)

  // Navigate to the hotel page with dates in the URL — Expedia fires rate/offer
  // GraphQL queries on load. Intercept the response containing pricing data.
  const hotelUrl = `https://www.expedia.com/h${propertyId}.Hotel-Information?chkin=${checkIn}&chkout=${checkOut}&adults=${adults}`

  let captured: unknown = null
  const handler = async (resp: PwResponse) => {
    if (captured) return
    try {
      const req = resp.request()
      if (!req.url().includes('/graphql') || req.method() !== 'POST') return
      const postData = req.postData() ?? ''
      if (!postData.includes('PropertyOffers') && !postData.includes('Rates')) return
      const json = await resp.json()
      const entry = Array.isArray(json) ? json[0] : json
      if (entry?.data) captured = entry.data
    } catch { /* ignore parse errors */ }
  }

  page.on('response', handler)
  try {
    await page.goto(hotelUrl, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
    const deadline = Date.now() + 20_000
    while (!captured && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500))
    }
  } finally {
    page.off('response', handler)
  }

  if (!captured) {
    throw errors.apiError('getHotelPrices', 'No pricing data captured — page may not have loaded offers')
  }

  const data = captured as Record<string, unknown>
  return trimResponse(data?.propertyRatesDateSelector ?? data?.propertyOffers ?? data)
}

async function getHotelReviews(page: Page, params: Record<string, unknown>, errors: ErrorHelpers): Promise<unknown> {
  const propertyId = String(params.propertyId ?? params.id)

  // Navigate to .Hotel-Information (not .Hotel-Reviews) — Akamai blocks
  // the reviews URL more aggressively. Reviews load lazily via GraphQL
  // when the user scrolls to the reviews section on the info page.
  const hotelUrl = `https://www.expedia.com/h${propertyId}.Hotel-Information`

  let captured: unknown = null
  const handler = async (resp: PwResponse) => {
    if (captured) return
    try {
      const req = resp.request()
      if (!req.url().includes('/graphql') || req.method() !== 'POST') return
      const postData = req.postData() ?? ''
      if (!postData.includes('Review')) return
      const json = await resp.json()
      // Handle batched responses
      const entries = Array.isArray(json) ? json : [json]
      for (const entry of entries) {
        if (!entry?.data) continue
        // Only capture responses with actual review content
        const d = entry.data as Record<string, unknown>
        const reviewInfo = (d?.propertyInfo as Record<string, unknown>)?.reviewInfo
        const reviews = (reviewInfo as Record<string, unknown>)?.reviews
        if (Array.isArray(reviews) && reviews.length > 0) {
          captured = d
          return
        }
        // Also check for PropertyFilteredReviewsQuery shape
        if (d?.propertyReviews || d?.propertyFilteredReviews) {
          captured = d
          return
        }
      }
    } catch { /* ignore parse errors */ }
  }

  page.on('response', handler)
  try {
    await page.goto(hotelUrl, { waitUntil: 'load', timeout: 30_000 }).catch(() => {})

    // Wait briefly for review data that may load with the page
    const initialWait = Date.now() + 5_000
    while (!captured && Date.now() < initialWait) {
      await new Promise(r => setTimeout(r, 500))
    }

    // Scroll to the reviews section to trigger lazy load
    if (!captured) {
      await page.evaluate(() => {
        // Look for reviews section anchor or heading
        const reviewSection = document.querySelector(
          '[data-stid*="review"], #reviews, [id*="review"]'
        )
        if (reviewSection) {
          reviewSection.scrollIntoView({ behavior: 'instant' })
        } else {
          // Scroll incrementally to trigger lazy loading
          window.scrollTo(0, document.body.scrollHeight * 0.5)
        }
      })
      await new Promise(r => setTimeout(r, 3_000))
    }

    // Try clicking reviews tab if present
    if (!captured) {
      await page.evaluate(() => {
        const reviewTab = document.querySelector<HTMLElement>(
          'a[href*="Reviews"], a[href*="reviews"], button[data-stid*="review"], [data-stid*="Reviews"]'
        )
        if (reviewTab) reviewTab.click()
        else window.scrollTo(0, document.body.scrollHeight * 0.8)
      })
      await new Promise(r => setTimeout(r, 3_000))
    }

    // Final scroll to bottom
    if (!captured) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      const deadline = Date.now() + 10_000
      while (!captured && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500))
      }
    }
  } finally {
    page.off('response', handler)
  }

  if (!captured) {
    throw errors.apiError('getHotelReviews', 'No review data captured — page may not have loaded reviews')
  }

  const data = captured as Record<string, unknown>
  return trimResponse(data?.propertyInfo?.reviewInfo ?? data?.propertyReviews ?? data)
}

/* ---------- helpers ---------- */

async function getDuaid(page: Page): Promise<string> {
  const duaid = await page.evaluate(() => {
    const match = document.cookie.match(/DUAID=([^;]+)/)
    return match?.[1] ?? ''
  })
  return duaid || crypto.randomUUID()
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, errors: ErrorHelpers) => Promise<unknown>> = {
  searchHotels,
  getHotelDetail,
  getHotelPrices,
  getHotelReviews,
  searchFlights,
  getFlightDetail,
}

const adapter: CustomRunner = {
  name: 'expedia-graphql',
  description: 'Expedia GraphQL API — hotels, flights via APQ',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const { errors } = helpers as unknown as { errors: ErrorHelpers }
    const handler = OPERATIONS[operation]
    if (!handler) {
      throw errors.unknownOp(operation)
    }
    return handler(page as Page, { ...params }, errors)
  },
}

export default adapter
