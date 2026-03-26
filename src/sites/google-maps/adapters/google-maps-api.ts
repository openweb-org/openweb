/**
 * Google Maps L3 adapter — SPA navigation + DOM extraction / internal preview API.
 *
 * Search:       Navigate to /maps/search/{query}/, extract from DOM
 * Place:        GET /maps/preview/place via page.evaluate(fetch()) with pb param
 * Directions:   Navigate to /maps/dir/{origin}/{destination}/, extract from DOM
 * Reviews:      GET /maps/preview/place — detailed review extraction
 * Photos:       GET /maps/preview/place — photo URL extraction
 * Nearby:       Navigate to /maps/search/{category}+near+{location}/, extract from DOM
 * Autocomplete: GET /maps/suggest via page.evaluate(fetch())
 *
 * Search, directions, and nearby use SPA navigation because their APIs require
 * session-specific tokens that only the Maps SPA generates during navigation.
 * Place details, reviews, photos, and autocomplete work via direct fetch.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'

const MAPS_BASE = 'https://www.google.com/maps'

/* ---------- helpers ---------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
    await page.evaluate(() => {
      window.location.href = 'https://www.google.com/maps'
    })
    await sleep(3000)
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}) // intentional: best-effort wait
  }
}

/** Navigate to a Maps search URL and extract place listings from DOM */
async function navigateAndExtractPlaces(page: Page, searchUrl: string): Promise<Array<Record<string, unknown>>> {
  await ensureMapsPage(page)

  await page.evaluate((url: string) => {
    window.location.href = url
  }, searchUrl)
  await sleep(5000)
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}) // intentional: best-effort wait
  await page.waitForSelector('a.hfpxzc', { timeout: 10000 }).catch(() => {}) // intentional: best-effort wait

  return page.evaluate(() => {
    const items = document.querySelectorAll('div[role="feed"] > div')
    const results: Array<Record<string, unknown>> = []
    for (const item of items) {
      const link = item.querySelector('a.hfpxzc') as HTMLAnchorElement | null
      if (!link) continue

      const name = link.getAttribute('aria-label')
      const href = link.getAttribute('href') || ''

      const placeIdMatch = href.match(/0x[0-9a-f]+:0x[0-9a-f]+/)
      const placeId = placeIdMatch ? placeIdMatch[0] : null

      const latLngMatch = href.match(/!3d([-\d.]+)!4d([-\d.]+)/)
      const lat = latLngMatch ? Number.parseFloat(latLngMatch[1]) : null
      const lng = latLngMatch ? Number.parseFloat(latLngMatch[2]) : null

      const ratingEl = item.querySelector('.MW4etd')
      const rating = ratingEl ? Number.parseFloat(ratingEl.textContent || '') : null

      const reviewEl = item.querySelector('.UY7F9')
      const reviewText = reviewEl?.textContent || ''
      const reviewCount = Number.parseInt(reviewText.replace(/[^0-9]/g, '')) || null

      let address: string | null = null
      for (const el of item.querySelectorAll('.W4Efsd span')) {
        const t = el.textContent || ''
        if (t.length > 10 && !t.includes('·') && !t.startsWith('Open') && !t.startsWith('Closed')) {
          address = t
        }
      }

      const text = item.textContent || ''
      const priceMatch = text.match(/\$[\d]+-[\d]+|\$+/)
      const priceLevel = priceMatch ? priceMatch[0] : null

      const typeEl = item.querySelector('.W4Efsd .W4Efsd:first-child span:first-child')
      const placeType = typeEl?.textContent || null

      results.push({
        placeId,
        name,
        address,
        rating: Number.isNaN(rating as number) ? null : rating,
        reviewCount,
        priceLevel,
        types: placeType ? [placeType] : [],
        lat,
        lng,
      })
    }
    return results
  })
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
  if (!Array.isArray(info)) throw new OpenWebError('No place data found', 'EXTRACT_FAILED')
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
      const reviewRating = dig(r, 4) as number | null
      const relativeTime = dig(r, 57) as string | null
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

async function getAutocompleteSuggestions(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const input = String(params.input ?? params.query ?? '')
  if (!input) throw OpenWebError.missingParam('input')

  await ensureMapsPage(page)

  const raw = await page.evaluate(async (q: string) => {
    const resp = await fetch(`/maps/suggest?authuser=0&hl=en&gl=us&q=${encodeURIComponent(q)}`, { credentials: 'include' })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return resp.text()
  }, input)

  const cleaned = raw.replace(/^\)\]\}'\n/, '')
  try {
    const data = JSON.parse(cleaned) as unknown[]
    const suggestArr = (Array.isArray(data[0]) ? data[0] : data) as unknown[][]
    const suggestions = suggestArr
      .filter(Array.isArray)
      .map((s) => ({
        text: (dig(s, 0, 0) as string | null) ?? (dig(s, 0) as string | null),
        placeId: dig(s, 0, 1) as string | null,
        description: dig(s, 0, 2) as string | null,
      }))
      .filter((s) => s.text && typeof s.text === 'string')
    return { input, suggestions }
  } catch {
    return { input, suggestions: [], raw: cleaned.substring(0, 500) }
  }
}

/* ---------- getDirections ---------- */

async function getDirections(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const origin = String(params.origin ?? '')
  const destination = String(params.destination ?? '')
  if (!origin || !destination) throw OpenWebError.missingParam('origin and destination')

  await ensureMapsPage(page)

  // Navigate to directions URL — Maps SPA loads route data during navigation
  const dirUrl = `${MAPS_BASE}/dir/${encodeURIComponent(origin)}/${encodeURIComponent(destination)}/`
  await page.evaluate((url: string) => {
    window.location.href = url
  }, dirUrl)
  await sleep(8000)
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {}) // intentional: best-effort wait

  // Extract route data from DOM
  const routes = await page.evaluate(() => {
    function parseRoute(text: string) {
      const duration = text.match(/(\d+\s*hr\s*\d*\s*min|\d+\s*min)(?!\w)/)
      const distance = text.match(/([\d,.]+)\s*(miles|mi(?!n))/)
      const via = text.match(/via\s+([\w\s\d-]+?)(?:\s*(?:Fastest|Details|$))/)
      if (!duration) return null
      return {
        name: via?.[1]?.trim() || 'Route',
        distanceText: distance ? `${distance[1]} ${distance[2]}` : '',
        durationText: duration[0].trim(),
        summary: /[Ff]astest/.test(text) ? 'Fastest route' : null,
      }
    }

    const results: Array<Record<string, unknown>> = []
    for (const s of document.querySelectorAll('[data-trip-index], .MespJc')) {
      const r = parseRoute(s.textContent || '')
      if (r) results.push(r)
    }

    // Fallback: parse entire directions panel by splitting on "via"
    if (results.length === 0) {
      const panel = document.querySelector('#section-directions-trip-0, [role="main"]')
      if (panel) {
        for (const block of (panel.textContent || '').split(/(?=via\s)/)) {
          const r = parseRoute(block)
          if (r) results.push(r)
        }
      }
    }
    return results
  })

  return { origin, destination, routes }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchPlaces,
  getPlaceDetails,
  getPlaceReviews,
  getPlacePhotos,
  getDirections,
  nearbySearch,
  getAutocompleteSuggestions,
}

const adapter: CodeAdapter = {
  name: 'google-maps-api',
  description: 'Google Maps — search, details, reviews, photos, directions, nearby search, autocomplete via SPA navigation + internal APIs',

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
