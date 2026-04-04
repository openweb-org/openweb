import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
/**
 * Google Maps L3 adapter — network interception + internal preview API.
 *
 * Search:       Navigate to /maps/search/, intercept /search?tbm=map response
 * Place:        GET /maps/preview/place via page.evaluate(fetch()) with pb param
 * Directions:   Navigate to /maps/dir/, intercept /maps/preview/directions response
 * Reviews:      GET /maps/preview/place — detailed review extraction
 * Photos:       GET /maps/preview/place — photo URL extraction
 * Hours:        GET /maps/preview/place — operating schedule extraction
 * About:        GET /maps/preview/place — description, category, attributes
 * Nearby:       Navigate to /maps/search/, intercept /search?tbm=map response
 * Autocomplete: Type into search box, intercept /s?suggest=p response
 * Geocode:      Navigate to /maps/search/, intercept /search?tbm=map response
 * RevGeocode:   Navigate to /@{lat},{lng},17z, extract address from DOM
 *
 * All search/directions/nearby/geocode use network interception (no DOM scraping).
 * Place details, reviews, photos, hours, and about work via fetch inside page context.
 */
import type { CodeAdapter } from '../../../types/adapter.js'

const MAPS_BASE = 'https://www.google.com/maps'

/* ---------- helpers ---------- */

function dig(arr: unknown, ...indices: number[]): unknown {
  let cur = arr
  for (const i of indices) {
    if (!Array.isArray(cur) || i >= cur.length) return null
    cur = cur[i]
  }
  return cur
}

async function ensureMapsPage(page: Page): Promise<void> {
  if (!page.url().includes('google.com/maps')) {
    await page.goto('https://www.google.com/maps', { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {}) // intentional: best-effort wait
  }
}

/** Parse the /search?tbm=map response into place objects.
 *  Organic results live at data[64][i][1] with stable field indices. */
function parseSearchResponse(raw: string): Array<Record<string, unknown>> {
  const cleaned = raw.replace(/^\)\]\}'\n/, '')
  const data = JSON.parse(cleaned)
  const entries = data[64] as unknown[][] | null
  if (!Array.isArray(entries)) return []

  const results: Array<Record<string, unknown>> = []
  for (const wrapper of entries) {
    if (!Array.isArray(wrapper)) continue
    const p = wrapper[1] as unknown[] | null
    if (!Array.isArray(p)) continue

    const placeId = (p[10] as string | null) ?? null
    const name = (p[11] as string | null) ?? null
    if (!name) continue

    const coords = p[9] as number[] | null
    const lat = coords?.[2] ?? null
    const lng = coords?.[3] ?? null

    const ratingArr = p[4] as unknown[] | null
    const rating = (Array.isArray(ratingArr) && typeof ratingArr[7] === 'number') ? ratingArr[7] : null

    const types = Array.isArray(p[13]) ? (p[13] as string[]) : []

    // Address: prefer [18] (full formatted), fall back to joining [2] parts
    const fullAddr = p[18] as string | null
    const addrParts = Array.isArray(p[2]) ? (p[2] as string[]).join(', ') : null
    // [18] includes the place name prefix ("Name, Addr") — strip it for cleaner output
    let address = fullAddr ?? addrParts
    if (address && name && address.startsWith(`${name}, `)) {
      address = address.slice(name.length + 2)
    }

    const website = dig(p, 7, 0) as string | null
    const phone = dig(p, 178, 0, 0) as string | null
    const priceMatch = (typeof fullAddr === 'string' ? fullAddr : '').match(/\$[\d]+-[\d]+|\$+/)
    const priceLevel = priceMatch ? priceMatch[0] : null

    results.push({ placeId, name, address, rating, reviewCount: null, priceLevel, types, lat, lng })
  }
  return results
}

/** Navigate to a Maps search URL and intercept the /search?tbm=map API response */
async function navigateAndExtractPlaces(page: Page, searchUrl: string): Promise<Array<Record<string, unknown>>> {
  await ensureMapsPage(page)

  // Set up response interception before navigating
  const searchPromise = page.waitForResponse(
    (resp) => resp.url().includes('/search?') && resp.url().includes('tbm=map') && resp.status() === 200,
    { timeout: 15_000 },
  ).catch(() => null)

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })

  const searchResp = await searchPromise
  if (!searchResp) return []

  const body = await searchResp.text()
  return parseSearchResponse(body)
}

/* ---------- searchPlaces ---------- */

async function searchPlaces(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
  if (!query) throw OpenWebError.missingParam('query')

  const searchUrl = `${MAPS_BASE}/search/${encodeURIComponent(query)}/`
  const places = await navigateAndExtractPlaces(page, searchUrl)
  return { query, places }
}

/* ---------- shared: fetchPlaceInfo ---------- */

async function fetchPlaceInfo(page: Page, placeId: string, query: string): Promise<unknown[]> {
  await ensureMapsPage(page)

  const pb = `!1m3!1s${placeId}!3m1!1d50000!4m2!3d37.8!4d-122.4!12m4!2m3!1i360!2i120!4i8!13m1!2m0`

  const result = await page.evaluate(
    async (args: { pb: string; q: string }) => {
      const url = `/maps/preview/place?authuser=0&hl=en&gl=us&pb=${encodeURIComponent(args.pb)}&q=${encodeURIComponent(args.q)}`
      const resp = await fetch(url, { credentials: 'include' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return resp.text()
    },
    { pb, q: query },
  )

  const data = JSON.parse(result.replace(/^\)\]\}'\n/, '')) as unknown[]
  const info = data[6] as unknown[]
  if (!Array.isArray(info)) throw OpenWebError.apiError('place', 'No place data found')
  return info
}

/* ---------- getPlaceDetails ---------- */

async function getPlaceDetails(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const placeId = String(params.placeId ?? params.place_id ?? '')
  const query = String(params.query ?? params.name ?? '')
  if (!placeId) throw OpenWebError.missingParam('placeId')

  const info = await fetchPlaceInfo(page, placeId, query)

  const name = dig(info, 11) as string | null
  const address = (dig(info, 18) as string | null) ?? (dig(info, 39) as string | null)
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

  // Extract reviews from [6][31][1]
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
    placeId: (dig(info, 10) as string | null) ?? placeId,
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

/* ---------- getPlaceReviews ---------- */

async function getPlaceReviews(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const placeId = String(params.placeId ?? params.place_id ?? '')
  const query = String(params.query ?? params.name ?? '')
  if (!placeId) throw OpenWebError.missingParam('placeId')

  const info = await fetchPlaceInfo(page, placeId, query)

  const placeName = dig(info, 11) as string | null
  const rating = dig(info, 4, 7) as number | null
  const reviewCount = dig(info, 4, 8) as number | null

  // Extract detailed reviews from [6][31][1]
  const reviewsArr = dig(info, 31, 1) as unknown[][] | null
  const reviews: Array<Record<string, unknown>> = []
  if (Array.isArray(reviewsArr)) {
    for (const r of reviewsArr) {
      if (!Array.isArray(r)) continue
      const text = dig(r, 1) as string | null
      if (!text) continue
      const authorUrl = dig(r, 0, 0) as string | null
      const authorName = dig(r, 0, 1) as string | null
      // Rating index may shift — try [4], fall back to [2], [3]
      const rawRating = dig(r, 4)
      const reviewRating = typeof rawRating === 'number' ? rawRating
        : typeof dig(r, 2) === 'number' ? (dig(r, 2) as number)
        : typeof dig(r, 3) === 'number' ? (dig(r, 3) as number)
        : null
      const rawTime = dig(r, 57) ?? dig(r, 5) ?? dig(r, 27)
      const relativeTime = typeof rawTime === 'string' ? rawTime : null
      reviews.push({
        text,
        authorName,
        authorUrl,
        rating: reviewRating,
        relativeTime,
      })
    }
  }

  return { placeName, placeId, rating, reviewCount, reviews }
}

/* ---------- getPlacePhotos ---------- */

async function getPlacePhotos(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const placeId = String(params.placeId ?? params.place_id ?? '')
  const query = String(params.query ?? params.name ?? '')
  if (!placeId) throw OpenWebError.missingParam('placeId')

  const info = await fetchPlaceInfo(page, placeId, query)
  const placeName = dig(info, 11) as string | null

  // Try [6][37][0] then [6][171][0] for photo arrays
  const photos: Array<Record<string, unknown>> = []
  for (const path of [[37, 0], [171, 0]] as const) {
    if (photos.length > 0) break
    const arr = dig(info, ...path) as unknown[][] | null
    if (!Array.isArray(arr)) continue
    for (const p of arr) {
      if (!Array.isArray(p)) continue
      const url = (dig(p, 0, 6, 0) as string | null) ?? (dig(p, 0, 0) as string | null) ?? (dig(p, 0) as string | null)
      if (url && typeof url === 'string' && url.startsWith('http')) {
        photos.push({
          url,
          width: dig(p, 0, 6, 2) as number | null,
          height: dig(p, 0, 6, 1) as number | null,
        })
      }
    }
  }

  return { placeName, placeId, photos }
}

/* ---------- nearbySearch ---------- */

async function nearbySearch(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const category = String(params.category ?? params.type ?? '')
  const location = String(params.location ?? params.near ?? '')
  if (!category) throw OpenWebError.missingParam('category')
  if (!location) throw OpenWebError.missingParam('location')

  const searchUrl = `${MAPS_BASE}/search/${encodeURIComponent(`${category} near ${location}`)}/`
  const places = await navigateAndExtractPlaces(page, searchUrl)
  return { category, location, places }
}

/* ---------- getAutocompleteSuggestions ---------- */

/** Parse the Maps suggest API response (protobuf-like nested arrays) into suggestion objects */
function parseSuggestResponse(raw: string): Array<{ text: string | null; placeId: string | null; description: string | null }> {
  const cleaned = raw.replace(/^\)\]\}'\n/, '')
  const parsed = JSON.parse(cleaned)
  const entries = dig(parsed, 0, 1) as unknown[][] | null
  if (!Array.isArray(entries)) return []

  const results: Array<{ text: string | null; placeId: string | null; description: string | null }> = []
  for (const entry of entries) {
    if (!Array.isArray(entry)) continue
    const details = entry[22] as unknown[] | null
    if (!Array.isArray(details)) continue

    const mainText = (dig(details, 1, 0) as string | null) ?? (dig(details, 0, 0) as string | null)
    const secondaryText = dig(details, 2, 0) as string | null

    // Place ID at details[13][0][0]
    const placeId = dig(details, 13, 0, 0) as string | null

    if (mainText) {
      results.push({
        text: mainText,
        placeId,
        description: secondaryText,
      })
    }
  }
  return results
}

async function getAutocompleteSuggestions(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const input = String(params.input ?? params.query ?? '')
  if (!input) throw OpenWebError.missingParam('input')

  await ensureMapsPage(page)

  // Intercept the suggest API response triggered by typing into the search box
  const suggestPromise = page.waitForResponse(
    (resp) => resp.url().includes('/s?') && resp.url().includes('suggest=p') && resp.url().includes('tbm=map'),
    { timeout: 10_000 },
  ).catch(() => null)

  const searchBox = await page.waitForSelector('input[name="q"], #searchboxinput', { timeout: 10_000 }).catch(() => null)
  if (!searchBox) return { input, suggestions: [] }

  await searchBox.focus()
  await searchBox.fill(input)

  const suggestResp = await suggestPromise
  if (!suggestResp || !suggestResp.ok()) return { input, suggestions: [] }

  const body = await suggestResp.text()
  const suggestions = parseSuggestResponse(body)

  return { input, suggestions }
}

/* ---------- directions (shared helper) ---------- */

/** Parse the /maps/preview/directions response into route objects.
 *  Routes live at data[0][1][i][0] with structure [mode, name, [meters, text], [seconds, text]]. */
function parseDirectionsResponse(raw: string, requestedMode: number): Array<Record<string, unknown>> {
  const cleaned = raw.replace(/^\)\]\}'\n/, '')
  const data = JSON.parse(cleaned)
  const routeContainer = dig(data, 0, 1) as unknown[][] | null
  if (!Array.isArray(routeContainer)) return []

  const results: Array<Record<string, unknown>> = []
  for (const route of routeContainer) {
    if (!Array.isArray(route)) continue
    const summary = route[0] as unknown[] | null
    if (!Array.isArray(summary)) continue

    const mode = summary[0]
    const name = summary[1]
    const distArr = summary[2] as unknown[] | null
    const durArr = summary[3] as unknown[] | null

    if (typeof mode !== 'number' || typeof name !== 'string') continue
    if (!Array.isArray(distArr) || !Array.isArray(durArr)) continue
    if (typeof distArr[0] !== 'number' || typeof durArr[0] !== 'number') continue

    // Filter to only the requested mode (driving=0, bicycling=1, walking=2, transit=3)
    if (mode !== requestedMode) continue

    results.push({
      name: name || 'Route',
      distanceText: (distArr[1] as string) || '',
      durationText: (durArr[1] as string) || '',
      summary: results.length === 0 ? 'Fastest route' : null,
    })
  }
  return results
}

/** Travel modes: 0=driving, 1=bicycling, 2=walking, 3=transit */
async function getDirectionsForMode(page: Page, params: Record<string, unknown>, mode: number): Promise<unknown> {
  const origin = String(params.origin ?? '')
  const destination = String(params.destination ?? '')
  if (!origin || !destination) throw OpenWebError.missingParam('origin and destination')

  await ensureMapsPage(page)

  // Set up response interception before navigating
  const dirPromise = page.waitForResponse(
    (resp) => resp.url().includes('/maps/preview/directions') && resp.status() === 200,
    { timeout: 15_000 },
  ).catch(() => null)

  const modeParam = mode > 0 ? `data=!3m1!4b1!4m2!4m1!3e${mode}` : ''
  const dirUrl = `${MAPS_BASE}/dir/${encodeURIComponent(origin)}/${encodeURIComponent(destination)}/${modeParam}`
  await page.goto(dirUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })

  const dirResp = await dirPromise
  if (!dirResp) return { origin, destination, routes: [] }

  const body = await dirResp.text()
  const routes = parseDirectionsResponse(body, mode)

  return { origin, destination, routes }
}

const getDirections = (p: Page, params: Record<string, unknown>) => getDirectionsForMode(p, params, 0)
const getTransitDirections = (p: Page, params: Record<string, unknown>) => getDirectionsForMode(p, params, 3)
const getWalkingDirections = (p: Page, params: Record<string, unknown>) => getDirectionsForMode(p, params, 2)
const getBicyclingDirections = (p: Page, params: Record<string, unknown>) => getDirectionsForMode(p, params, 1)

/* ---------- getPlaceHours ---------- */

async function getPlaceHours(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const placeId = String(params.placeId ?? params.place_id ?? '')
  const query = String(params.query ?? params.name ?? '')
  if (!placeId) throw OpenWebError.missingParam('placeId')

  const info = await fetchPlaceInfo(page, placeId, query)
  const placeName = dig(info, 11) as string | null
  const statusText = dig(info, 203, 1, 4, 0) as string | null
  const hoursArr = dig(info, 203, 1, 0) as unknown[][] | null
  const schedule: Array<{ day: string; hours: string }> = []
  if (Array.isArray(hoursArr)) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    for (const entry of hoursArr) {
      if (!Array.isArray(entry)) continue
      const dayIdx = entry[0] as number
      const timeStr = dig(entry, 1, 0) as string | null
      if (typeof dayIdx === 'number' && days[dayIdx]) {
        schedule.push({ day: days[dayIdx], hours: timeStr ?? 'Closed' })
      }
    }
  }
  return { placeName, placeId, status: statusText, schedule }
}

/* ---------- geocode ---------- */

async function geocode(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const address = String(params.address ?? '')
  if (!address) throw OpenWebError.missingParam('address')
  const places = await navigateAndExtractPlaces(page, `${MAPS_BASE}/search/${encodeURIComponent(address)}/`)
  const first = places[0]
  if (!first) return { address, lat: null, lng: null, placeId: null, formattedAddress: null }
  return { address, lat: first.lat, lng: first.lng, placeId: first.placeId, formattedAddress: first.address, name: first.name }
}

/* ---------- reverseGeocode ---------- */

async function reverseGeocode(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const lat = Number(params.lat)
  const lng = Number(params.lng)
  if (Number.isNaN(lat) || Number.isNaN(lng)) throw OpenWebError.missingParam('lat and lng')

  await page.goto(`${MAPS_BASE}/@${lat},${lng},17z`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {}) // intentional: best-effort wait

  const result = await page.evaluate(() => {
    const title = document.title.replace(' - Google Maps', '').trim()
    const h1 = document.querySelector('h1')?.textContent?.trim()
    const addrEl = document.querySelector('button[data-item-id="address"]')
    const address = addrEl?.textContent?.trim() || h1 || title || null
    const url = window.location.href
    const pidMatch = url.match(/0x[0-9a-f]+:0x[0-9a-f]+/)
    return { address, name: h1 || null, placeId: pidMatch?.[0] || null }
  })
  return { lat, lng, ...result }
}

/* ---------- getPlaceAbout ---------- */

async function getPlaceAbout(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const placeId = String(params.placeId ?? params.place_id ?? '')
  const query = String(params.query ?? params.name ?? '')
  if (!placeId) throw OpenWebError.missingParam('placeId')

  const info = await fetchPlaceInfo(page, placeId, query)
  return {
    placeName: dig(info, 11) as string | null,
    placeId: (dig(info, 10) as string | null) ?? placeId,
    description: dig(info, 154, 0, 0) as string | null,
    category: dig(info, 76, 0, 0) as string | null,
    address: (dig(info, 18) as string | null) ?? (dig(info, 39) as string | null),
    priceLevel: dig(info, 4, 2) as string | null,
    rating: dig(info, 4, 7) as number | null,
    reviewCount: dig(info, 4, 8) as number | null,
    website: dig(info, 7, 0) as string | null,
    phone: dig(info, 178, 0, 0) as string | null,
  }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchPlaces,
  getPlaceDetails,
  getPlaceReviews,
  getPlacePhotos,
  getDirections,
  getTransitDirections,
  getWalkingDirections,
  getBicyclingDirections,
  nearbySearch,
  getAutocompleteSuggestions,
  getPlaceHours,
  geocode,
  reverseGeocode,
  getPlaceAbout,
}

const adapter: CodeAdapter = {
  name: 'google-maps-api',
  description: 'Google Maps — search, details, reviews, photos, directions (driving/transit/walking/cycling), nearby, autocomplete, hours, geocode via SPA + internal APIs',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('google.com')
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw OpenWebError.unknownOp(operation)
      return handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
