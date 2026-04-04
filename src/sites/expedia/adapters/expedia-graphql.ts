import type { Page } from 'patchright'
/**
 * Expedia L3 adapter — GraphQL APQ via browser fetch.
 *
 * Expedia serves all data through a single GraphQL endpoint using
 * Automatic Persisted Queries (APQ): only sha256 hashes, no query text.
 * Heavy Akamai bot detection → page transport required.
 */
import type { CodeAdapter } from '../../../types/adapter.js'

const GRAPHQL_URL = 'https://www.expedia.com/graphql'

/* ---------- APQ hashes (captured 2026-04-01) ---------- */

const HASHES = {
  PropertyListingQuery: '82abb7da6738db4c904e4d10130072236a751b5a315f6dfaf92474793597bc33',
  PropertyDetailsBasicQuery: 'd84aa742ff292a7a866582569e4ecc143ba5cdb28d11e76e0c94d65957ae972c',
  PropertyRatesDateSelectorQuery: '4ff3b2253a967d392964e0e2827ec4c1c0c6ea28096f4d75594dc4d22204aee1',
  FlightsSearchResultsLoadedQuery: 'f9c3e8bd42ba4953543034718f090c9bb847344c5e46dceeeb4de157815b24e5',
  FlightsUniversalSortAndFiltersQuery: '5b55478286daf34b3639f41b6c915c10ed361c06c37446570ca7d00aa46cb45a',
} as const

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

/* ---------- GraphQL fetch ---------- */

async function apqFetch(
  page: Page,
  operationName: string,
  variables: Record<string, unknown>,
  clientInfo: string,
): Promise<unknown> {
  const hash = HASHES[operationName as keyof typeof HASHES]
  if (!hash) {
    const err = Object.assign(new Error(`Unknown operation: ${operationName}`), { failureClass: 'fatal' as const })
    throw err
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
    const err = Object.assign(new Error(`HTTP ${result.status}`), { failureClass: 'retriable' as const })
    throw err
  }

  const json = JSON.parse(result.text)
  // Handle batched responses (array of results)
  const data = Array.isArray(json) ? json[0] : json
  if (data?.errors?.length) {
    const msg = data.errors[0]?.message ?? 'GraphQL error'
    const err = Object.assign(new Error(`GraphQL ${operationName}: ${msg}`), { failureClass: 'fatal' as const })
    throw err
  }

  return data?.data
}

/* ---------- operation handlers ---------- */

async function searchHotels(page: Page, params: Record<string, unknown>): Promise<unknown> {
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
  )) as Record<string, unknown>
  return data?.propertySearch
}

async function getHotelDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
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

  const data = (await apqFetch(page, 'PropertyDetailsBasicQuery', variables, 'shopping-pwa,unknown,us-east-1')) as Record<
    string,
    unknown
  >
  return data?.propertyInfo
}

async function searchFlights(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const origin = String(params.origin ?? params.from ?? 'New York (NYC-All Airports)')
  const destination = String(params.destination ?? params.to ?? 'Los Angeles (LAX-Los Angeles Intl.)')
  const departureDate = String(params.departureDate ?? params.departure ?? '2026-05-10')
  const returnDate = params.returnDate ?? params.return
  const cabinClass = String(params.cabinClass ?? 'COACH')
  const adults = Number(params.adults ?? 1)
  const offset = Number(params.offset ?? 0)
  const limit = Number(params.limit ?? 25)

  const duaid = await getDuaid(page)

  const journeyCriteria = [
    {
      departureDate: parseDate(departureDate),
      destination,
      origin,
      originAirportLocationType: 'UNSPECIFIED',
      destinationAirportLocationType: 'UNSPECIFIED',
    },
  ]

  // Add return leg for round trips
  if (returnDate) {
    journeyCriteria.push({
      departureDate: parseDate(String(returnDate)),
      destination: origin,
      origin: destination,
      originAirportLocationType: 'UNSPECIFIED',
      destinationAirportLocationType: 'UNSPECIFIED',
    })
  }

  const variables = {
    faresSeparationType: 'BASE_AND_UPSELL',
    searchFilterValuesList: [],
    flightsSearchContext: {
      tripType: returnDate ? 'ROUND_TRIP' : 'ONE_WAY',
      previousOriginalBookingId: null,
      journeysContinuationId: null,
      hasCreditRedemptionIntent: null,
      originalBookingId: null,
      searchId: crypto.randomUUID(),
    },
    journeyCriteria,
    searchPreferences: { cabinClass },
    sortOption: null,
    travelerDetails: [{ travelerType: 'ADULT', count: adults }],
    searchPagination: { size: limit, startingIndex: offset },
    flightsSearchComponentCriteria: { queryParams: [] },
    shoppingContext: null,
    virtualAgentContext: null,
    context: buildContext(duaid),
    queryState: 'LOADED',
  }

  const data = (await apqFetch(
    page,
    'FlightsSearchResultsLoadedQuery',
    variables,
    'flights-shopping-pwa,unknown,us-east-1',
  )) as Record<string, unknown>
  return data?.flightsSearch
}

async function getFlightDetail(page: Page, params: Record<string, unknown>): Promise<unknown> {
  // Flight detail uses the same search query with specific filters
  // In Expedia's model, flight "detail" = search results with filter refinement
  // The detailed info (fares, segments) is in the search response itself
  return searchFlights(page, params)
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

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchHotels,
  getHotelDetail,
  searchFlights,
  getFlightDetail,
}

const adapter: CodeAdapter = {
  name: 'expedia-graphql',
  description: 'Expedia GraphQL API — hotels, flights via APQ',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('expedia.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://www.expedia.com')
    return cookies.some((c) => c.name === 'EG_SESSIONTOKEN')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) {
      const err = Object.assign(new Error(`Unknown operation: ${operation}`), { failureClass: 'fatal' as const })
      throw err
    }
    return handler(page, { ...params })
  },
}

export default adapter
