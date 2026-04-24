import type { Page } from 'patchright'

import type { CustomRunner, PreparedContext } from '../../../types/adapter.js'

type AnyRecord = Record<string, unknown>

/* ---------- operation → API path ---------- */

const API_PATHS: Record<string, { path: string; server?: string }> = {
  searchFlights:      { path: '/restapi/soa2/27015/FlightListSearch' },
  getFlightComfort:   { path: '/restapi/soa2/27015/BatchGetFlightComfort' },
  getGeneralInfo:     { path: '/restapi/soa2/27501/getGeneralInfo' },
  getHotDestinations: { path: '/restapi/soa2/20400/getGsHotSearchForTripOnline', server: 'https://www.trip.com' },
  searchTrains:       { path: '/restapi/soa2/31699/searchListForWeb' },
  getTrainStations:   { path: '/restapi/soa2/36040/loadStationList' },
  searchPOI:          { path: '/restapi/soa2/14427/poiSearch' },
  getDestinationInfo: { path: '/restapi/soa2/23044/getDestinationPageInfo.json', server: 'https://www.trip.com' },
  searchAttractions:  { path: '/restapi/soa2/28181/json/getByScenesCode', server: 'https://www.trip.com' },
  getFlightFilters:   { path: '/restapi/soa2/14427/getFlightFilters' },
  getAttractionDetail:{ path: '/restapi/soa2/28181/json/getDetailV2', server: 'https://www.trip.com' },
  getTrainCalendar:   { path: '/restapi/soa2/36040/getTrainCalendar' },
  getCityList:        { path: '/restapi/soa2/23044/getCityList', server: 'https://www.trip.com' },
}

/* ---------- Head/head enrichment ---------- */

const UPPERCASE_HEAD_OPS = new Set([
  'searchFlights', 'getFlightComfort', 'getGeneralInfo', 'searchPOI', 'getFlightFilters',
])

function enrichHead(operation: string, params: AnyRecord): AnyRecord {
  const body = { ...params }

  if (UPPERCASE_HEAD_OPS.has(operation)) {
    const head = (body.Head ?? {}) as AnyRecord
    body.Head = {
      Locale: 'en-US',
      Currency: 'USD',
      Group: 'Trip',
      Source: 'ONLINE',
      Version: '3',
      Channel: 'EnglishSite',
      SessionId: '1',
      PvId: '1',
      ...head,
    }
  } else {
    const head = (body.head ?? {}) as AnyRecord
    body.head = {
      syscode: '09',
      locale: 'en-US',
      currency: 'USD',
      lang: '01',
      cver: '1.0',
      sid: '8888',
      source: 'online',
      ...head,
    }
  }

  if (operation === 'searchFlights') {
    const sc = (body.searchCriteria ?? {}) as AnyRecord
    body.searchCriteria = {
      grade: 3,
      realGrade: 1,
      tripType: 1,
      journeyNo: 1,
      ...sc,
      passengerInfoType: { adultCount: 1, childCount: 0, infantCount: 0, ...(sc.passengerInfoType as AnyRecord ?? {}) },
    }
    body.mode = body.mode ?? 0
    body.sortInfoType = body.sortInfoType ?? { direction: true, orderBy: 'Direct', topList: [] }
  }

  return body
}

/* ---------- response trimming ---------- */

function trimResponse(data: unknown): unknown {
  if (data === null || data === undefined) return data
  if (Array.isArray(data)) return data.map(trimResponse)
  if (typeof data !== 'object') return data

  const obj = data as AnyRecord
  const out: AnyRecord = {}
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'ResponseStatus') continue
    if (k === 'responseHead') continue
    out[k] = trimResponse(v)
  }
  return out
}

/* ---------- adapter ---------- */

const adapter: CustomRunner = {
  name: 'ctrip',
  description: 'Trip.com — framework context enrichment + response trimming',

  async run(ctx: PreparedContext) {
    const { page, operation, params, helpers } = ctx
    const { pageFetch, errors } = helpers

    const route = API_PATHS[operation]
    if (!route) throw errors.unknownOp(operation)

    const pg = page as Page
    const serverUrl = route.server ?? ctx.serverUrl
    const url = `${serverUrl}${route.path}`
    const body = enrichHead(operation, params as AnyRecord)

    const result = await pageFetch(pg, {
      url,
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      timeout: 30_000,
    })

    if (result.status === 403) throw errors.needsLogin()

    let parsed: unknown
    try {
      parsed = JSON.parse(result.text)
    } catch {
      throw errors.apiError(operation, `Invalid JSON response (${result.status})`)
    }

    return trimResponse(parsed)
  },
}

export default adapter
