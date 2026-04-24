import type { Page, Response as PwResponse } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

/* ---------- types ---------- */

type ErrorHelpers = {
  unknownOp(op: string): Error
  httpError(status: number): Error
  apiError(label: string, msg: string): Error
}

type AnyRecord = Record<string, unknown>

/* ---------- shared intercept ---------- */

async function interceptPoll(
  page: Page,
  navigateUrl: string,
  pollUrlMatch: string,
  timeout = 30_000,
): Promise<AnyRecord | null> {
  let best: AnyRecord | null = null
  let bestCount = 0

  const handler = async (resp: PwResponse) => {
    if (!resp.url().includes(pollUrlMatch)) return
    if (resp.status() !== 200) return
    try {
      const body = await resp.body()
      const json = JSON.parse(body.toString()) as AnyRecord
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

/* ---------- response trimming ---------- */

const MAX_FLIGHT_RESULTS = 20
const MAX_BOOKING_OPTIONS = 3
const MAX_HOTEL_RESULTS = 20
const MAX_HOTEL_PROVIDERS = 3

function trimFlightResponse(data: AnyRecord): AnyRecord {
  const rawResults = data.results as AnyRecord[] | undefined
  const coreResults = (rawResults ?? []).filter(r => r.type === 'core')
  const trimmed = coreResults.slice(0, MAX_FLIGHT_RESULTS).map(r => {
    const bookingOptions = (r.bookingOptions as AnyRecord[] ?? [])
      .slice(0, MAX_BOOKING_OPTIONS)
      .map(opt => ({
        providerCode: opt.providerCode,
        price: (opt.displayPrice as AnyRecord)?.price,
        totalPrice: ((opt.fees as AnyRecord)?.totalPrice as AnyRecord)?.price ?? (opt.displayPrice as AnyRecord)?.price,
        currency: (opt.displayPrice as AnyRecord)?.currency,
      }))
    return {
      resultId: r.resultId,
      ...(r.isBest ? { isBest: true } : {}),
      ...(r.isCheapest ? { isCheapest: true } : {}),
      legs: r.legs,
      bookingOptions,
    }
  })

  const usedLegIds = new Set<string>()
  const usedSegmentIds = new Set<string>()
  for (const r of trimmed) {
    for (const leg of r.legs as AnyRecord[]) {
      const legId = (leg.id ?? leg.legId ?? leg) as string
      usedLegIds.add(legId)
    }
  }

  const legs = data.legs as AnyRecord | undefined
  const trimmedLegs: AnyRecord = {}
  if (legs) {
    for (const [id, leg] of Object.entries(legs)) {
      if (!usedLegIds.has(id)) continue
      const legData = leg as AnyRecord
      trimmedLegs[id] = {
        duration: legData.duration,
        departure: legData.departure,
        arrival: legData.arrival,
        segments: (legData.segments as AnyRecord[])?.map(s => {
          usedSegmentIds.add(s.id as string)
          return { id: s.id }
        }),
      }
    }
  }

  const segments = data.segments as AnyRecord | undefined
  const trimmedSegments: AnyRecord = {}
  if (segments) {
    for (const [id, seg] of Object.entries(segments)) {
      if (!usedSegmentIds.has(id)) continue
      const s = seg as AnyRecord
      trimmedSegments[id] = {
        airline: s.airline,
        flightNumber: s.flightNumber,
        origin: s.origin,
        destination: s.destination,
        departure: s.departure,
        arrival: s.arrival,
        duration: s.duration,
        equipmentTypeName: s.equipmentTypeName,
      }
    }
  }

  return {
    searchId: data.searchId,
    status: data.status,
    sortMode: data.sortMode,
    totalCount: data.totalCount,
    filteredCount: data.filteredCount,
    results: trimmed,
    legs: trimmedLegs,
    segments: trimmedSegments,
    airlines: data.airlines,
    airports: data.airports,
  }
}

function trimHotelResponse(data: AnyRecord): AnyRecord {
  const rawResults = data.results as AnyRecord[] | undefined
  const coreResults = (rawResults ?? []).filter(r => r.resultType === 'core')
  const trimmed = coreResults.slice(0, MAX_HOTEL_RESULTS).map(r => {
    const rating = r.rating as AnyRecord | undefined
    const providers = (r.providers as AnyRecord[] ?? [])
      .slice(0, MAX_HOTEL_PROVIDERS)
      .map(p => ({
        name: p.localizedProviderName,
        providerCode: p.providerCode,
        price: (p.price as AnyRecord)?.price,
        totalPrice: (p.totalPrice as AnyRecord)?.price,
        currency: (p.price as AnyRecord)?.currency,
        ...(p.freebies ? { freebies: (p.freebies as AnyRecord[]).map(f => f.localizedFreebie).filter(Boolean) } : {}),
      }))
    const geo = r.geolocation as AnyRecord | undefined
    return {
      name: r.localizedHotelName,
      stars: r.stars,
      rating: rating?.score ?? null,
      ratingText: rating?.localizedRatingCategory ?? null,
      reviews: rating?.reviewCount ?? null,
      location: geo?.localizedCity ?? null,
      distance: geo?.localizedDisplayDistance ?? null,
      providers,
      detailUrl: r.detailsUrl ?? null,
      amenities: (r.amenities as AnyRecord[] | undefined)?.map(a => a.localizedName).filter(Boolean),
      ...(r.savingsPercent ? { savingsPercent: r.savingsPercent } : {}),
    }
  })

  return {
    searchId: data.searchId,
    status: data.status,
    sortMode: data.sortMode,
    totalCount: data.totalCount,
    filteredCount: data.filteredCount,
    results: trimmed,
  }
}

/* ---------- operation handlers ---------- */

async function searchFlights(
  page: Page,
  params: AnyRecord,
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

  let url = `https://www.kayak.com/flights/${origin}-${destination}/${departureDate}`
  if (returnDate) url += `/${returnDate}`
  url += `?sort=${sort}`
  if (adults > 1) url += `&adults=${adults}`
  if (cabinClass !== 'economy') url += `&cabin=${cabinClass}`

  const data = await interceptPoll(page, url, '/search/dynamic/flights/poll')
  if (!data) {
    throw errors.apiError('searchFlights', 'No flight results captured — search may have timed out or been blocked')
  }

  return trimFlightResponse(data)
}

async function searchHotels(
  page: Page,
  params: AnyRecord,
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

  const location = destination.replace(/\s+/g, '-')
  let url = `https://www.kayak.com/hotels/${location}/${checkInDate}/${checkOutDate}/${guests}adults`
  if (rooms > 1) url += `/${rooms}rooms`
  url += `?sort=${sort}`

  const data = await interceptPoll(page, url, '/search/dynamic/hotels/poll')
  if (!data) {
    throw errors.apiError('searchHotels', 'No hotel results captured — search may have timed out or been blocked')
  }

  return trimHotelResponse(data)
}

async function searchCars(
  page: Page,
  params: AnyRecord,
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
  (page: Page, params: AnyRecord, errors: ErrorHelpers) => Promise<unknown>
> = {
  searchFlights,
  searchHotels,
  searchCars,
}

const adapter: CustomRunner = {
  name: 'kayak-search',
  description: 'Kayak search — flights, hotels, cars via poll interception',
  warmTimeoutMs: 8_000,

  async warmReady(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://www.kayak.com')
    return cookies.some((c) => c.name === '_abck')
  },

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const { errors } = helpers as { errors: ErrorHelpers }
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page as Page, { ...params }, errors)
  },
}

export default adapter
