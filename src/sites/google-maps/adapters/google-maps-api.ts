/**
 * Google Maps L3 adapter — SPA navigation + DOM extraction / internal preview API.
 *
 * Search:     Navigate to /maps/search/{query}/, extract from DOM
 * Place:      GET /maps/preview/place via page.evaluate(fetch()) with pb param
 * Directions: Navigate to /maps/dir/{origin}/{destination}/, extract from DOM
 *
 * Search and directions use SPA navigation because their APIs require
 * session-specific tokens that only the Maps SPA generates during navigation.
 * Place details work via direct fetch with a minimal pb parameter.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright-core'

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

/* ---------- searchPlaces ---------- */

async function searchPlaces(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
  if (!query) throw new Error('query is required')

  await ensureMapsPage(page)

  // Navigate to search URL — Maps SPA handles the API call internally
  const searchUrl = `${MAPS_BASE}/search/${encodeURIComponent(query)}/`
  await page.evaluate((url: string) => {
    window.location.href = url
  }, searchUrl)
  await sleep(5000)
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}) // intentional: best-effort wait

  // Wait for results to appear in DOM
  await page.waitForSelector('a.hfpxzc', { timeout: 10000 }).catch(() => {}) // intentional: best-effort wait

  // Extract place data from DOM
  const places = await page.evaluate(() => {
    const items = document.querySelectorAll('div[role="feed"] > div')
    const results: Array<Record<string, unknown>> = []
    items.forEach((item) => {
      const link = item.querySelector('a.hfpxzc') as HTMLAnchorElement | null
      if (!link) return

      const name = link.getAttribute('aria-label')
      const href = link.getAttribute('href') || ''

      const placeIdMatch = href.match(/0x[0-9a-f]+:0x[0-9a-f]+/)
      const placeId = placeIdMatch ? placeIdMatch[0] : null

      const latLngMatch = href.match(/!3d([-\d.]+)!4d([-\d.]+)/)
      const lat = latLngMatch ? parseFloat(latLngMatch[1]) : null
      const lng = latLngMatch ? parseFloat(latLngMatch[2]) : null

      const ratingEl = item.querySelector('.MW4etd')
      const rating = ratingEl ? parseFloat(ratingEl.textContent || '') : null

      const reviewEl = item.querySelector('.UY7F9')
      const reviewText = reviewEl?.textContent || ''
      const reviewCount = parseInt(reviewText.replace(/[^0-9]/g, '')) || null

      // Extract address from the info spans
      const spans = item.querySelectorAll('.W4Efsd span')
      let address: string | null = null
      spans.forEach((el) => {
        const t = el.textContent || ''
        if (t.length > 10 && !t.includes('·') && !t.startsWith('Open') && !t.startsWith('Closed')) {
          address = t
        }
      })

      // Price level
      const text = item.textContent || ''
      const priceMatch = text.match(/\$[\d]+-[\d]+|\$+/)
      const priceLevel = priceMatch ? priceMatch[0] : null

      // Type (first span in first W4Efsd)
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
    })
    return results
  })

  return { query, places }
}

/* ---------- getPlaceDetails ---------- */

async function getPlaceDetails(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const placeId = String(params.placeId ?? params.place_id ?? '')
  const query = String(params.query ?? params.name ?? '')
  if (!placeId) throw new Error('placeId is required')

  await ensureMapsPage(page)

  // Minimal working pb parameter for place details
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
  if (!Array.isArray(info)) {
    return { name: null, placeId, error: 'No place data found' }
  }

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

/* ---------- getDirections ---------- */

async function getDirections(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const origin = String(params.origin ?? '')
  const destination = String(params.destination ?? '')
  if (!origin || !destination) throw new Error('origin and destination are required')

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
    const results: Array<Record<string, unknown>> = []

    // Look for route sections — Google Maps uses different selectors
    // Try the main trip sections
    const sections = document.querySelectorAll('[data-trip-index], .MespJc')
    sections.forEach((section) => {
      const text = section.textContent || ''

      // Duration: match "N hr N min" or "N min" — use word boundary to avoid false matches
      const durationMatch = text.match(/(\d+\s*hr\s*\d*\s*min|\d+\s*min)(?!\w)/)
      // Distance: match "N miles" or "N mi" but NOT "N min" — require "miles" or "mi" followed by non-"n"
      const distanceMatch = text.match(/([\d,.]+)\s*(miles|mi(?!n))/)
      // Via route name
      const viaMatch = text.match(/via\s+([\w\s\d-]+?)(?:\s*(?:Fastest|Details|$))/)

      if (durationMatch) {
        results.push({
          name: viaMatch?.[1]?.trim() || 'Route',
          distanceText: distanceMatch ? `${distanceMatch[1]} ${distanceMatch[2]}` : '',
          durationText: durationMatch[0].trim(),
          summary: text.includes('fastest') || text.includes('Fastest') ? 'Fastest route' : null,
        })
      }
    })

    // Fallback: parse the entire directions panel
    if (results.length === 0) {
      const panel = document.querySelector('#section-directions-trip-0, [role="main"]')
      if (panel) {
        const text = panel.textContent || ''
        // Find all route-like patterns
        const routeBlocks = text.split(/(?=via\s)/)
        for (const block of routeBlocks) {
          const via = block.match(/via\s+([\w\s\d-]+)/)?.[1]?.trim()
          const duration = block.match(/(\d+\s*hr\s*\d*\s*min|\d+\s*min)(?!\w)/)?.[0]
          const distance = block.match(/([\d,.]+)\s*(miles|mi(?!n))/)?.[0]
          if (via && duration) {
            results.push({
              name: via,
              distanceText: distance || '',
              durationText: duration,
              summary: null,
            })
          }
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
  getDirections,
}

const adapter: CodeAdapter = {
  name: 'google-maps-api',
  description: 'Google Maps — place search, details with reviews, driving directions via SPA navigation + internal APIs',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('google.com')
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) throw new Error(`Unknown operation: ${operation}`)
    return handler(page, { ...params })
  },
}

export default adapter
