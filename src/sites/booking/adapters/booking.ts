import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

/**
 * Booking.com adapter — Apollo SSR cache + GraphQL intercept.
 *
 * - searchHotels: Apollo SSR cache (inline JSON with ROOT_QUERY) — zero DOM
 * - getHotelReviews: GraphQL page.evaluate(fetch) to /dml/graphql — zero DOM
 * - getHotelPrices: GraphQL page.evaluate(fetch) to /dml/graphql — zero DOM
 * - searchFlights: DOM extraction (flights API returns 403, no alternative)
 *
 * Note: getHotelDetail was migrated to the declarative `script_json`
 * extraction (type_filter=Hotel) in openapi.yaml — no adapter code needed.
 *
 * Bot detection: PerimeterX — requires page transport, node fetch blocked.
 * Fetch: NOT patched (native). No client-side signing.
 */

type PageFetch = (
  page: Page,
  options: {
    url: string
    method?: 'GET' | 'POST'
    body?: string
    headers?: Record<string, string>
    credentials?: 'same-origin' | 'include'
    timeout?: number
  },
) => Promise<{ status: number; text: string }>

type GraphqlFetch = (
  page: Page,
  options: {
    url: string
    operationName: string
    variables: Record<string, unknown>
    query?: string
    headers?: Record<string, string>
    timeout?: number
  },
) => Promise<unknown>

type AdapterErrors = {
  unknownOp(op: string): Error
  missingParam(p: string): Error
  wrap(error: unknown): Error
}

/* ---------- Apollo SSR cache extraction ---------- */

/**
 * Extract Apollo Client SSR cache from inline <script type="application/json">.
 * Returns the parsed ROOT_QUERY or null.
 */
async function extractApolloCache(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/json"]')
    for (const s of scripts) {
      const text = s.textContent || ''
      if (!text.includes('ROOT_QUERY')) continue
      try {
        return JSON.parse(text) as Record<string, unknown>
      } catch { /* skip */ }
    }
    return null
  })
}

/* ---------- Hotel search ---------- */

async function searchHotels(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const url = new URL('https://www.booking.com/searchresults.html')
  url.searchParams.set('ss', String(params.ss ?? ''))
  if (params.checkin) url.searchParams.set('checkin', String(params.checkin))
  if (params.checkout) url.searchParams.set('checkout', String(params.checkout))
  url.searchParams.set('group_adults', String(params.group_adults ?? 2))
  url.searchParams.set('no_rooms', String(params.no_rooms ?? 1))

  await page.goto(url.toString(), { waitUntil: 'load', timeout: 30_000 })
  await page.waitForSelector('[data-testid="property-card"], script[type="application/json"]', { timeout: 10_000 }).catch(() => {})

  // Try Apollo cache first (structured, zero DOM)
  const cache = await extractApolloCache(page)
  if (cache) {
    const hotels = extractHotelsFromCache(cache)
    if (hotels.length > 0) return { count: hotels.length, hotels: hotels.slice(0, 30) }
  }

  // Fallback: DOM extraction (same as before)
  return page.evaluate(() => {
    const cards = document.querySelectorAll('[data-testid="property-card"]')
    const hotels: {
      name: string; url: string; price: string | null; rating: string | null
      ratingText: string | null; reviewCount: string | null; distance: string | null
    }[] = []
    for (const card of cards) {
      const title = card.querySelector('[data-testid="title"]')?.textContent?.trim()
      const link = card.querySelector('a[data-testid="title-link"]') as HTMLAnchorElement | null
      if (!title || !link) continue
      const reviewEl = card.querySelector('[data-testid="review-score"]')
      const reviewText = reviewEl?.textContent?.trim() ?? ''
      const scoreMatch = reviewText.match(/Scored\s+([\d.]+)\s+([\d.]+)\s*([A-Za-z ]+?)\s+([\d,]+)\s*reviews/)
      hotels.push({
        name: title, url: link.href,
        price: card.querySelector('[data-testid="price-and-discounted-price"]')?.textContent?.trim() ?? null,
        rating: scoreMatch?.[2] ?? null, ratingText: scoreMatch?.[3]?.trim() ?? null,
        reviewCount: scoreMatch?.[4]?.replace(/,/g, '') ?? null,
        distance: card.querySelector('[data-testid="distance"]')?.textContent?.trim() ?? null,
      })
    }
    return { count: hotels.length, hotels: hotels.slice(0, 30) }
  })
}

/** Extract hotel results from Apollo SSR cache. */
function extractHotelsFromCache(cache: Record<string, unknown>): {
  name: string; url: string; price: string | null; rating: string | null
  ratingText: string | null; reviewCount: string | null; distance: string | null
}[] {
  const rootQuery = cache.ROOT_QUERY as Record<string, unknown> | undefined
  if (!rootQuery) return []

  // Find searchQueries → search({...}) → results
  const searchQueries = rootQuery.searchQueries as Record<string, unknown> | undefined
  if (!searchQueries) return []

  const searchKey = Object.keys(searchQueries).find(k => k.startsWith('search('))
  if (!searchKey) return []

  const searchData = searchQueries[searchKey] as Record<string, unknown>
  const results = searchData?.results as unknown[]
  if (!Array.isArray(results)) return []

  const hotels: {
    name: string; url: string; price: string | null; rating: string | null
    ratingText: string | null; reviewCount: string | null; distance: string | null
  }[] = []

  for (const result of results) {
    const r = resolveRef(cache, result)
    if (!r || r.__typename !== 'SearchResultProperty') continue

    const displayName = resolveRef(cache, r.displayName) ?? r.displayName as Record<string, unknown>
    const name = (displayName?.text as string) ?? ''
    if (!name) continue

    const basic = resolveRef(cache, r.basicPropertyData) ?? r.basicPropertyData as Record<string, unknown>
    const location = resolveRef(cache, r.location) ?? r.location as Record<string, unknown>
    const basicLocation = basic ? (resolveRef(cache, (basic as Record<string, unknown>).location) ?? (basic as Record<string, unknown>).location as Record<string, unknown>) : null

    // Build URL from pageName + countryCode
    const pageName = (basic as Record<string, unknown>)?.pageName as string ?? ''
    const countryCode = (basicLocation as Record<string, unknown>)?.countryCode as string ?? ''
    const hotelUrl = pageName && countryCode
      ? `https://www.booking.com/hotel/${countryCode}/${pageName}.html`
      : ''

    // Reviews
    const reviews = basic ? (resolveRef(cache, (basic as Record<string, unknown>).reviews) ?? (basic as Record<string, unknown>).reviews as Record<string, unknown>) : null
    const totalScore = (reviews as Record<string, unknown>)?.totalScore as number | undefined
    const reviewsCount = (reviews as Record<string, unknown>)?.reviewsCount as number | undefined
    const scoreTextTag = (reviews as Record<string, unknown>)?.totalScoreTextTag as Record<string, unknown> | undefined
    const ratingText = (scoreTextTag?.translation as string) ?? null

    // Price — from priceDisplayInfoIrene
    const priceInfo = resolveRef(cache, r.priceDisplayInfoIrene) ?? r.priceDisplayInfoIrene as Record<string, unknown>
    let price: string | null = null
    if (priceInfo) {
      const avgPrice = priceInfo.averagePricePerNight as Record<string, unknown> | undefined
      price = (avgPrice?.amount as string) ?? null
    }

    // Distance
    const mainDistance = (location as Record<string, unknown>)?.mainDistance as string ?? null

    hotels.push({
      name,
      url: hotelUrl,
      price,
      rating: totalScore != null ? String(totalScore) : null,
      ratingText,
      reviewCount: reviewsCount != null ? String(reviewsCount) : null,
      distance: mainDistance,
    })
  }

  return hotels
}

/** Resolve Apollo cache __ref pointer. */
function resolveRef(cache: Record<string, unknown>, val: unknown): Record<string, unknown> | null {
  if (!val || typeof val !== 'object') return null
  const obj = val as Record<string, unknown>
  if (obj.__ref && typeof obj.__ref === 'string') {
    return cache[obj.__ref] as Record<string, unknown> | null
  }
  return obj as Record<string, unknown>
}

/* ---------- Hotel reviews — GraphQL page.evaluate(fetch) ---------- */

/** ReviewScores GraphQL query — extracted from Booking.com's RoomPageDesktopRDS request. */
const REVIEW_SCORES_QUERY = `query ReviewScoresQuery($input: ReviewScoresInput) {
  reviewScores(input: $input) {
    reviewScores {
      count
      name
      value
      translatedName
      __typename
    }
    __typename
  }
}`

async function getHotelReviews(
  page: Page, params: Record<string, unknown>, graphqlFetch: GraphqlFetch,
): Promise<unknown> {
  const hotelId = await resolveHotelId(page, params)
  if (!hotelId) {
    return { score: null, reviewCount: null, subscores: null, featured: [] }
  }

  try {
    const data = await graphqlFetch(page, {
      url: '/dml/graphql?lang=en-us',
      operationName: 'ReviewScoresQuery',
      variables: {
        input: { hotelId, questions: ['bed_comfort'], customerType: ['ALL'] },
      },
      query: REVIEW_SCORES_QUERY,
    }) as Record<string, unknown>

    const reviewResult = data?.reviewScores as Record<string, unknown>
    const scores = reviewResult?.reviewScores as { name: string; value: number; count: number; translatedName: string }[] ?? []

    // Build subscores map
    const subscores: Record<string, string> = {}
    let totalScore = 0
    let totalCount = 0
    for (const s of scores) {
      const key = s.name?.toLowerCase().replace(/\s+/g, '_') ?? ''
      if (key) subscores[key] = String(Math.round(s.value * 10) / 10)
      totalScore += s.value
      totalCount = Math.max(totalCount, s.count)
    }
    const avgScore = scores.length > 0 ? Math.round((totalScore / scores.length) * 10) / 10 : null

    return {
      score: avgScore != null ? String(avgScore) : null,
      reviewCount: totalCount > 0 ? String(totalCount) : null,
      subscores: Object.keys(subscores).length > 0 ? subscores : null,
      featured: [], // GraphQL doesn't return featured review text; would need separate query
    }
  } catch {
    // Fallback: DOM extraction
    return extractReviewsFromDom(page)
  }
}

/** Resolve hotelId from params or from page globals. */
async function resolveHotelId(page: Page, params: Record<string, unknown>): Promise<number | null> {
  if (params.hotelId) return Number(params.hotelId)

  // Try to get from booking.env on the current page
  return page.evaluate(() => {
    const env = (window as unknown as Record<string, unknown>).booking as Record<string, unknown> | undefined
    const hotelEnv = env?.env as Record<string, unknown> | undefined
    const id = hotelEnv?.b_hotel_id
    return id ? Number(id) : null
  })
}

/** DOM fallback for reviews — same logic as old adapter. */
async function extractReviewsFromDom(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const scoreComponent = document.querySelector('[data-testid="review-score-component"]')
    const scoreText = scoreComponent?.textContent?.trim() ?? ''
    const scoreMatch = scoreText.match(/Scored\s+([\d.]+)\s+([\d.]+)/)
    const countMatch = scoreText.match(/([\d,]+)\s*reviews/)

    const subscores: Record<string, string> = {}
    for (const el of document.querySelectorAll('[data-testid="review-subscore"]')) {
      const text = el.textContent?.trim() ?? ''
      const match = text.match(/^(.+?)\s*([\d.]+)$/)
      if (match) subscores[match[1].toLowerCase().replace(/\s+/g, '_')] = match[2]
    }

    const featured = [...document.querySelectorAll('[data-testid="featuredreview"]')].slice(0, 5).map((el) => {
      const text = el.querySelector('[data-testid="featuredreview-text"], [data-testid="featuredreviewcard-text"]')?.textContent?.trim()
      const avatar = el.querySelector('[data-testid="featuredreview-avatar"], [data-testid="featuredreviewcard-avatar"]')?.textContent?.trim()
      const fullText = el.textContent?.trim() ?? ''
      const countryMatch = fullText.match(/\n([A-Z][\w\s]+)\n/)
      return {
        text: text ?? fullText.match(/"([^"]+)"/)?.[1] ?? null,
        author: avatar ?? null,
        country: countryMatch?.[1]?.trim() ?? null,
      }
    })

    return {
      score: scoreMatch?.[2] ?? null,
      reviewCount: countMatch?.[1]?.replace(/,/g, '') ?? null,
      subscores: Object.keys(subscores).length > 0 ? subscores : null,
      featured,
    }
  })
}

/* ---------- Hotel prices — GraphQL page.evaluate(fetch) ---------- */

const ROOM_DETAIL_QUERY = `query RoomDetailQuery($input: RDSRoomDetailQueryInput!) {
  roomDetail(roomDetailQueryInput: $input) {
    property {
      id
      name
      roomsDetails {
        id
        translations { name description __typename }
        roomSizeM2
        bedConfigurations {
          beds { bedType count __typename }
          __typename
        }
        __typename
      }
      __typename
    }
    categorizedFacilitiesForAllRooms {
      roomId
      categorizedFacilities {
        category
        facilities { name __typename }
        __typename
      }
      __typename
    }
    highlightsForAllRooms(roomDetailQueryInput: $input) {
      roomId
      roomHighlights {
        ... on RDSRoomSizeHighlight { areaValue __typename }
        ... on RDSRoomFacilityHighlight { name __typename }
        __typename
      }
      __typename
    }
    __typename
  }
}`

async function getHotelPrices(
  page: Page, params: Record<string, unknown>, graphqlFetch: GraphqlFetch,
): Promise<unknown> {
  const hotelId = await resolveHotelId(page, params)
  if (!hotelId) {
    return { count: 0, rooms: [] }
  }

  // Build search config from URL params or defaults
  const checkin = String(params.checkin ?? '')
  const checkout = String(params.checkout ?? '')

  try {
    const data = await graphqlFetch(page, {
      url: '/dml/graphql?lang=en-us',
      operationName: 'RoomDetailQuery',
      variables: {
        input: {
          hotelId: String(hotelId),
          searchConfig: {
            searchConfigDate: { checkin: checkin || undefined, checkout: checkout || undefined },
            nbRooms: 1,
            nbAdults: Number(params.group_adults ?? 2),
            nbChildren: 0,
            childrenAges: [],
          },
          highlightedBlocks: [],
          selectedFilters: '',
          travelReason: 'LEISURE',
        },
      },
      query: ROOM_DETAIL_QUERY,
    }) as Record<string, unknown>

    const roomDetail = data?.roomDetail as Record<string, unknown>
    const property = roomDetail?.property as Record<string, unknown>
    const roomsDetails = property?.roomsDetails as Record<string, unknown>[] ?? []

    // Build facilities map by roomId
    const facilitiesMap = new Map<string, string[]>()
    const categorized = roomDetail?.categorizedFacilitiesForAllRooms as Record<string, unknown>[] ?? []
    for (const entry of categorized) {
      const roomId = String(entry.roomId)
      const cats = entry.categorizedFacilities as Record<string, unknown>[] ?? []
      const facs: string[] = []
      for (const cat of cats) {
        const facilities = cat.facilities as { name: string }[] ?? []
        for (const f of facilities) if (f.name) facs.push(f.name)
      }
      facilitiesMap.set(roomId, facs.slice(0, 8))
    }

    // Build highlights map by roomId
    const highlightsMap = new Map<string, string | null>()
    const highlights = roomDetail?.highlightsForAllRooms as Record<string, unknown>[] ?? []
    for (const entry of highlights) {
      const roomId = String(entry.roomId)
      const roomHighlights = entry.roomHighlights as Record<string, unknown>[] ?? []
      for (const h of roomHighlights) {
        if (h.__typename === 'RDSRoomSizeHighlight' && h.areaValue) {
          highlightsMap.set(roomId, `${h.areaValue} m²`)
        }
      }
    }

    const rooms = roomsDetails.map(room => {
      const roomId = String(room.id)
      const translations = room.translations as { name: string; description: string } | undefined
      const bedConfigs = room.bedConfigurations as { beds: { bedType: string; count: number }[] }[] ?? []
      const beds = bedConfigs.flatMap(c => c.beds).map(b => `${b.count} ${b.bedType}`).join(', ')

      return {
        name: translations?.name ?? 'Room',
        bed: beds || null,
        size: highlightsMap.get(roomId) ?? (room.roomSizeM2 ? `${room.roomSizeM2} m²` : null),
        facilities: facilitiesMap.get(roomId) ?? [],
        price: null, // Room-level prices require availability check (separate API)
        perNight: null,
      }
    })

    return { count: rooms.length, rooms }
  } catch {
    // Fallback: DOM extraction
    return extractPricesFromDom(page)
  }
}

/** DOM fallback for prices — same logic as old adapter. */
async function extractPricesFromDom(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const table = document.querySelector('table.hprt-table')
    if (!table) return { count: 0, rooms: [] }
    const seen = new Set<string>()
    const rooms: {
      name: string; bed: string | null; size: string | null
      facilities: string[]; price: string | null; perNight: string | null
    }[] = []
    for (const row of table.querySelectorAll('tr.js-rt-block-row')) {
      const name = row.querySelector('.hprt-roomtype-icon-link')?.textContent?.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      const bed = row.querySelector('.hprt-roomtype-bed')?.textContent?.trim() ?? null
      const size = row.querySelector('.hprt-roomtype-room-size')?.textContent?.trim() ?? null
      const facilities = [...row.querySelectorAll('.hprt-facilities-facility')]
        .map(f => f.textContent?.trim() ?? '').filter(Boolean).slice(0, 8)
      const rowText = row.textContent ?? ''
      const priceMatch = rowText.match(/\$([\d,]+)\s*Price/)
      const perNightMatch = rowText.match(/\$([\d,]+)\s*per night/)
      rooms.push({
        name, bed, size, facilities,
        price: priceMatch ? `$${priceMatch[1]}` : null,
        perNight: perNightMatch ? `$${perNightMatch[1]}` : null,
      })
    }
    return { count: rooms.length, rooms }
  })
}

/* ---------- Flights search (DOM — API is 403 gated) ---------- */

async function searchFlights(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const route = String(params.route ?? '')
  const url = new URL(`https://flights.booking.com/flights/${route}/`)
  if (params.type) url.searchParams.set('type', String(params.type))
  if (params.depart) url.searchParams.set('depart', String(params.depart))
  if (params.return) url.searchParams.set('return', String(params.return))
  if (params.adults) url.searchParams.set('adults', String(params.adults))
  if (params.cabinClass) url.searchParams.set('cabinClass', String(params.cabinClass))
  if (params.from) url.searchParams.set('from', String(params.from))
  if (params.to) url.searchParams.set('to', String(params.to))
  if (params.sort) url.searchParams.set('sort', String(params.sort))

  await page.goto(url.toString(), { waitUntil: 'load', timeout: 30_000 })
  await page.waitForSelector('[data-testid="searchresults_card"]', { timeout: 15_000 }).catch(() => {})

  return page.evaluate(() => {
    const cards = document.querySelectorAll('[data-testid="searchresults_card"]')
    const flights: {
      carrier: string | null; departureTime: string | null; arrivalTime: string | null
      departureAirport: string | null; arrivalAirport: string | null
      duration: string | null; stops: string | null; price: string | null
    }[] = []
    for (const card of cards) {
      const priceEl = card.querySelector('[data-testid="upt_price"]')
      const priceText = priceEl?.textContent?.trim() ?? ''
      flights.push({
        carrier: card.querySelector('[data-testid="flight_card_carriers"]')?.textContent?.trim() ?? null,
        departureTime: card.querySelector('[data-testid="flight_card_segment_departure_time_0"]')?.textContent?.trim() ?? null,
        arrivalTime: card.querySelector('[data-testid="flight_card_segment_destination_time_0"]')?.textContent?.trim() ?? null,
        departureAirport: card.querySelector('[data-testid="flight_card_segment_departure_airport_0"]')?.textContent?.trim() ?? null,
        arrivalAirport: card.querySelector('[data-testid="flight_card_segment_destination_airport_0"]')?.textContent?.trim() ?? null,
        duration: card.querySelector('[data-testid="flight_card_segment_duration_0"]')?.textContent?.trim() ?? null,
        stops: card.querySelector('[data-testid="flight_card_segment_stops_0"]')?.textContent?.trim() ?? null,
        price: priceText.match(/\$[\d,]+/)?.[0] ?? null,
      })
    }
    return { count: flights.length, flights: flights.slice(0, 30) }
  })
}

/* ---------- Adapter export ---------- */

const OPERATIONS: Record<string, string> = {
  searchHotels: 'searchHotels',
  getHotelReviews: 'getHotelReviews',
  getHotelPrices: 'getHotelPrices',
  searchFlights: 'searchFlights',
}

const adapter: CustomRunner = {
  name: 'booking',
  description: 'Booking.com — Apollo cache + GraphQL for hotels, DOM for flights',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const { graphqlFetch, errors } = helpers as unknown as {
      graphqlFetch: GraphqlFetch
      errors: AdapterErrors
    }
    if (!OPERATIONS[operation]) throw errors.unknownOp(operation)

    const p = { ...params }
    const pg = page as Page
    switch (operation) {
      case 'searchHotels': return searchHotels(pg, p)
      case 'getHotelReviews': return getHotelReviews(pg, p, graphqlFetch)
      case 'getHotelPrices': return getHotelPrices(pg, p, graphqlFetch)
      case 'searchFlights': return searchFlights(pg, p)
      default: throw errors.unknownOp(operation)
    }
  },
}

export default adapter
