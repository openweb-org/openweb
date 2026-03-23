/**
 * Google Maps L3 adapter — internal preview APIs via Playwright page.request.
 *
 * Search:     GET /search?tbm=map&q={query}&pb={viewport}
 * Place:      GET /maps/preview/place?q={name}&pb={placeId+viewport}
 * Directions: GET /maps/preview/directions?pb={origin+destination+options}
 *
 * All responses are JSON prefixed with )]}\n (XSS prevention).
 * Data is deeply nested arrays (protobuf-derived), not keyed objects.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright'

const BASE = 'https://www.google.com'

/* ---------- pb param builders ---------- */

function searchPb(limit: number): string {
  // Viewport set to US-wide view, results limited by !7i{limit}
  return [
    '!4m12',
    '!1m3!1d50000000!2d-98.5!3d39.5', // US center, wide zoom
    '!2m3!1f0!2f0!3f0',
    '!3m2!1i1024!2i768',
    '!4f13.1',
    `!7i${limit}`,
    '!10b1',
    '!12m25!1m5!18b1!30b1!31m1!1b1!34e1',
    '!2m4!5m1!6e2!20e3!39b1',
    '!10b1!12b1!13b1!16b1!17m1!3e1',
    '!20m3!5e2!6b1!14b1',
  ].join('')
}

function placePb(placeId: string): string {
  return [
    `!1m1!1s${placeId}`,
    '!12m4!2m3!1i360!2i120!4i8',
    '!13m57',
    '!2m2!1i203!2i100',
    '!3m2!2i4!5b1',
    '!6m6!1m2!1i86!2i86!1m2!1i408!2i240',
    '!7m33!1m3!1e1!2b0!3e3!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e8!2b0!3e3',
    '!1m3!1e10!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e9!2b1!3e2!1m3!1e10!2b0!3e6',
    '!20m4!2m3!1i200!2i200!3i200!32b1',
    '!19m4!2m3!1i334!2i250!3i8!20b1',
    '!20b1!23b1!25b1!26b1!30m1!2b1',
  ].join('')
}

function directionsPb(origin: string, destination: string): string {
  return [
    `!1m2!1s${origin}!6e0`,
    `!1m2!1s${destination}!6e0`,
    '!3m12!1m3!1d50000000!2d-98.5!3d39.5',
    '!2m3!1f0.0!2f0.0!3f0.0',
    '!3m2!1i1024!2i768',
    '!4f13.1',
    '!6m55!1m5!18b1!30b1!31m1!1b1!34e1',
    '!2m4!5m1!6e2!20e3!39b1',
    '!6m26!49b1!63m0!66b1!74i150000!85b1!91b1',
    '!114b1!149b1!178b1!206b1!209b1!212b1!216b1!222b1',
  ].join('')
}

/* ---------- response parser ---------- */

function parseMapResponse(text: string): unknown {
  const clean = text.replace(/^\)\]\}'\n/, '')
  return JSON.parse(clean)
}

/* ---------- safe array access ---------- */

function dig(arr: unknown, ...indices: number[]): unknown {
  let cur = arr
  for (const i of indices) {
    if (!Array.isArray(cur) || i >= cur.length) return null
    cur = cur[i]
  }
  return cur
}

/* ---------- operation handlers ---------- */

async function searchPlaces(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
  const limit = Number(params.limit ?? 20)
  if (!query) throw new Error('query is required')

  const url = new URL('/search', BASE)
  url.searchParams.set('tbm', 'map')
  url.searchParams.set('authuser', '0')
  url.searchParams.set('hl', 'en')
  url.searchParams.set('gl', 'us')
  url.searchParams.set('pb', searchPb(limit))
  url.searchParams.set('q', query)

  const resp = await page.request.fetch(url.toString(), {
    headers: {
      Accept: '*/*',
      Referer: 'https://www.google.com/maps/',
    },
  })

  if (!resp.ok()) {
    throw new Error(`Google Maps search: HTTP ${resp.status()}`)
  }

  const text = await resp.text()
  // Response may be: {"c":0,"d":"...escaped json..."} (browser) or )]}\n[[...]] (direct fetch)
  let data: unknown[]
  if (text.startsWith('{')) {
    const outer = JSON.parse(text) as { c: number; d: string }
    const inner = outer.d.replace(/^\)\]\}'\n/, '')
    data = JSON.parse(inner) as unknown[]
  } else {
    data = parseMapResponse(text) as unknown[]
  }

  // data[3] contains the array of results (each is a nested place array)
  const resultArrays = (data[3] ?? []) as unknown[][]
  const places = resultArrays.map((r) => {
    if (!Array.isArray(r)) return null
    // r[0] = place ID hex, r[1] = name
    // r[2] = [[null, null, lat, lng], ...]
    // r[3] = address parts
    // r[7] = rating, r[8] = review count
    const placeId = dig(r, 0) as string | null
    const name = dig(r, 1) as string | null
    const coords = dig(r, 2) as number[] | null
    const lat = coords?.[2] ?? null
    const lng = coords?.[3] ?? null
    const address = dig(r, 3) as string | null
    const rating = dig(r, 7) as number | null
    const reviewCount = dig(r, 8) as number | null
    const priceLevel = dig(r, 4, 2) as string | null
    const types = dig(r, 9) as string[] | null

    return {
      placeId,
      name,
      address,
      rating,
      reviewCount,
      priceLevel,
      types: Array.isArray(types) ? types : [],
      lat,
      lng,
    }
  }).filter(Boolean)

  return { query, places }
}

async function getPlaceDetails(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const placeId = String(params.placeId ?? params.place_id ?? '')
  const query = String(params.query ?? params.name ?? '')
  if (!placeId) throw new Error('placeId is required')

  const url = new URL('/maps/preview/place', BASE)
  url.searchParams.set('authuser', '0')
  url.searchParams.set('hl', 'en')
  url.searchParams.set('gl', 'us')
  url.searchParams.set('pb', placePb(placeId))
  if (query) url.searchParams.set('q', query)

  const resp = await page.request.fetch(url.toString(), {
    headers: {
      Accept: '*/*',
      Referer: 'https://www.google.com/maps/',
    },
  })

  if (!resp.ok()) {
    throw new Error(`Google Maps place: HTTP ${resp.status()}`)
  }

  const data = parseMapResponse(await resp.text()) as unknown[]
  const info = data[6] as unknown[]
  if (!Array.isArray(info)) {
    return { name: null, placeId, error: 'No place data found' }
  }

  // Extract fields from the deeply nested array
  const name = dig(info, 11) as string | null
  const address = dig(info, 18) as string | null ?? dig(info, 39) as string | null
  const coords = dig(info, 9) as number[] | null
  const lat = coords?.[2] ?? null
  const lng = coords?.[3] ?? null
  const rating = dig(info, 4, 7) as number | null
  const reviewCount = dig(info, 4, 8) as number | null
  const priceLevel = dig(info, 4, 2) as string | null
  const website = dig(info, 7, 0) as string | null
  const phone = dig(info, 178, 0, 0) as string | null
  const placeType = dig(info, 76, 0, 0) as string | null
  const description = dig(info, 154, 0, 0) as string | null
  const hoursText = dig(info, 203, 1, 4, 0) as string | null

  // Extract reviews
  const reviewsArr = dig(info, 31, 1) as unknown[][] | null
  const reviews: Array<{ text: string; authorUrl: string | null }> = []
  if (Array.isArray(reviewsArr)) {
    for (const r of reviewsArr) {
      if (!Array.isArray(r)) continue
      const text = dig(r, 1) as string | null
      const authorUrl = dig(r, 0, 0) as string | null
      if (text) reviews.push({ text, authorUrl })
    }
  }

  return {
    name,
    placeId: dig(info, 10) as string | null ?? placeId,
    address,
    lat,
    lng,
    rating,
    reviewCount,
    priceLevel,
    website,
    phone,
    placeType,
    description,
    hours: hoursText,
    reviews,
  }
}

async function getDirections(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const origin = String(params.origin ?? '')
  const destination = String(params.destination ?? '')
  if (!origin || !destination) throw new Error('origin and destination are required')

  const url = new URL('/maps/preview/directions', BASE)
  url.searchParams.set('authuser', '0')
  url.searchParams.set('hl', 'en')
  url.searchParams.set('gl', 'us')
  url.searchParams.set('pb', directionsPb(origin, destination))

  const resp = await page.request.fetch(url.toString(), {
    headers: {
      Accept: '*/*',
      Referer: 'https://www.google.com/maps/',
    },
  })

  if (!resp.ok()) {
    throw new Error(`Google Maps directions: HTTP ${resp.status()}`)
  }

  const data = parseMapResponse(await resp.text()) as unknown[]
  const routesData = data[0] as unknown[]

  // Origin/destination info at [0][0] and [0][1]
  const originName = dig(routesData, 0, 0, 0, 0) as string | null ?? origin
  const destName = dig(routesData, 1, 0, 0, 0) as string | null ?? destination

  // Route options at [0][1][N]
  const routeOptions = dig(routesData, 1) as unknown[][] | null
  const routes: Array<{
    name: string
    distanceMeters: number
    distanceText: string
    durationSeconds: number
    durationText: string
    summary: string | null
  }> = []

  if (Array.isArray(routeOptions)) {
    for (const route of routeOptions) {
      if (!Array.isArray(route)) continue
      const routeInfo = route[0] as unknown[]
      if (!Array.isArray(routeInfo)) continue

      const name = dig(routeInfo, 1) as string | null
      const distanceMeters = dig(routeInfo, 2, 0) as number | null
      const distanceText = dig(routeInfo, 2, 1) as string | null
      const durationSeconds = dig(routeInfo, 3, 0) as number | null
      const durationText = dig(routeInfo, 3, 1) as string | null

      if (name && distanceText && durationText) {
        // Look for summary text
        const summary = dig(route, 22, 8, 0, 0) as string | null

        routes.push({
          name,
          distanceMeters: distanceMeters ?? 0,
          distanceText,
          durationSeconds: durationSeconds ?? 0,
          durationText,
          summary,
        })
      }
    }
  }

  return { origin: originName, destination: destName, routes }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchPlaces,
  getPlaceDetails,
  getDirections,
}

const adapter: CodeAdapter = {
  name: 'google-maps-api',
  description: 'Google Maps — place search, details with reviews, driving directions via internal preview APIs',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('google.com')
  },

  async isAuthenticated(): Promise<boolean> {
    return true // Public Maps APIs, no auth required
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) {
      throw new Error(`Unknown operation: ${operation}`)
    }
    return handler(page, { ...params })
  },
}

export default adapter
