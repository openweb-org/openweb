/**
 * TripAdvisor adapter — DOM/LD+JSON extraction from browser-rendered pages.
 *
 * TripAdvisor uses GraphQL with hashed queries at /data/graphql/ids
 * and DataDome bot detection. All data must be extracted via browser.
 * Hotel details come from LD+JSON (LodgingBusiness), attractions from
 * LD+JSON (LocalBusiness), and listings/reviews from DOM elements.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'

/* ---------- Hotel operations ---------- */

async function searchHotels(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const hotels: {
      name: string
      url: string
      locationId: string | null
      rating: string | null
      reviewCount: string | null
    }[] = []
    const seen = new Set<string>()

    const links = document.querySelectorAll('a[href*="Hotel_Review"]')
    for (const a of links) {
      const el = a as HTMLAnchorElement
      const name = el.textContent?.trim() ?? ''
      if (name.length < 3 || name.length > 100 || seen.has(el.href)) continue
      seen.add(el.href)
      const idMatch = el.href.match(/-d(\d+)-/)
      hotels.push({
        name,
        url: el.href,
        locationId: idMatch?.[1] ?? null,
        rating: null,
        reviewCount: null,
      })
    }

    // Enrich with rating/review data from nearby elements
    const ratingEls = document.querySelectorAll('[data-automation="bubbleRatingValue"]')
    const reviewEls = document.querySelectorAll('[data-automation="bubbleReviewCount"]')
    const ratings = [...ratingEls].map((el) => el.textContent?.trim() ?? '')
    const reviews = [...reviewEls].map((el) => el.textContent?.replace(/[(),reviews\s]/g, '').trim() ?? '')

    for (let i = 0; i < Math.min(hotels.length, ratings.length); i++) {
      hotels[i].rating = ratings[i] || null
      hotels[i].reviewCount = reviews[i] || null
    }

    return { count: hotels.length, hotels: hotels.slice(0, 30) }
  })
}

async function getHotelDetail(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent!)
        if (data['@type'] !== 'LodgingBusiness') continue
        return {
          name: data.name ?? null,
          rating: data.aggregateRating?.ratingValue ?? null,
          reviewCount: data.aggregateRating?.reviewCount ?? null,
          priceRange: data.priceRange ?? null,
          starRating: data.starRating?.ratingValue ?? null,
          address: data.address
            ? {
                street: data.address.streetAddress ?? null,
                city: data.address.addressLocality ?? null,
                region: data.address.addressRegion ?? null,
                postalCode: data.address.postalCode ?? null,
                country: data.address.addressCountry?.name ?? null,
              }
            : null,
          telephone: data.telephone ?? null,
          url: data.url ?? null,
          images: Array.isArray(data.image) ? data.image.slice(0, 5) : [],
          amenities: Array.isArray(data.amenityFeature)
            ? data.amenityFeature.map((a: { name?: string }) => a.name).filter(Boolean)
            : [],
        }
      } catch {
        /* skip */
      }
    }
    return null
  })
}

async function getHotelReviews(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const section = document.querySelector('[data-automation="ugcRedesign"]')
    if (!section) return { count: 0, reviews: [] }

    const text = section.innerText
    const lines = text.split('\n').filter((l) => l.trim().length > 0)

    // Extract overall rating breakdown
    const ratingMatch = text.match(
      /Excellent\n([\d,]+)\nGood\n([\d,]+)\nAverage\n([\d,]+)\nPoor\n([\d,]+)\nTerrible\n([\d,]+)/,
    )
    const breakdown = ratingMatch
      ? {
          excellent: Number.parseInt(ratingMatch[1].replace(/,/g, '')),
          good: Number.parseInt(ratingMatch[2].replace(/,/g, '')),
          average: Number.parseInt(ratingMatch[3].replace(/,/g, '')),
          poor: Number.parseInt(ratingMatch[4].replace(/,/g, '')),
          terrible: Number.parseInt(ratingMatch[5].replace(/,/g, '')),
        }
      : null

    // Extract AI summary
    const summaryMatch = text.match(/Reviews summary[\s\S]*?Powered by AI\n([\s\S]*?)(?=\n(?:Wrote|Show|Sort|Filter))/i)
    const aiSummary = summaryMatch?.[1]?.trim() ?? null

    // Extract sub-ratings
    const subRatings: Record<string, string> = {}
    const subRatingPattern = /(Rooms|Service|Value|Cleanliness|Location|Sleep Quality)\n([\d.]+)/g
    let match: RegExpExecArray | null
    while ((match = subRatingPattern.exec(text))) {
      subRatings[match[1].toLowerCase().replace(' ', '_')] = match[2]
    }

    return {
      breakdown,
      subRatings: Object.keys(subRatings).length > 0 ? subRatings : null,
      aiSummary,
    }
  })
}

async function getHotelPrices(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const priceEl = document.querySelector('[data-automation="finalPrice"]')
    const dealsEl = document.querySelector('[data-automation="view_all_deals_dropdown"]')

    const price = priceEl?.textContent?.trim() ?? null
    const dealsText = dealsEl?.textContent?.trim() ?? null
    const dealsMatch = dealsText?.match(/(\d+)\s+deals?\s+from\s+\$(\d+)/)

    return {
      price,
      dealCount: dealsMatch ? Number.parseInt(dealsMatch[1]) : null,
      lowestDealPrice: dealsMatch ? `$${dealsMatch[2]}` : null,
      dealsDescription: dealsText,
    }
  })
}

/* ---------- Restaurant operations ---------- */

async function searchRestaurants(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const restaurants: {
      name: string
      url: string
      locationId: string | null
      rating: string | null
      reviewCount: string | null
    }[] = []
    const seen = new Set<string>()

    const links = document.querySelectorAll('a[href*="Restaurant_Review"]')
    for (const a of links) {
      const el = a as HTMLAnchorElement
      const name = el.textContent?.trim() ?? ''
      if (name.length < 3 || name.length > 100 || seen.has(el.href)) continue
      seen.add(el.href)
      const idMatch = el.href.match(/-d(\d+)-/)
      restaurants.push({
        name,
        url: el.href,
        locationId: idMatch?.[1] ?? null,
        rating: null,
        reviewCount: null,
      })
    }

    return { count: restaurants.length, restaurants: restaurants.slice(0, 30) }
  })
}

async function getRestaurantDetail(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    // Try LD+JSON first (sometimes has Restaurant type)
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent!)
        if (data['@type'] === 'Restaurant') {
          return {
            name: data.name ?? null,
            rating: data.aggregateRating?.ratingValue ?? null,
            reviewCount: data.aggregateRating?.reviewCount ?? null,
            cuisine: data.servesCuisine ?? null,
            priceRange: data.priceRange ?? null,
            address: data.address
              ? {
                  street: data.address.streetAddress ?? null,
                  city: data.address.addressLocality ?? null,
                  region: data.address.addressRegion ?? null,
                  country: data.address.addressCountry?.name ?? null,
                }
              : null,
            telephone: data.telephone ?? null,
            url: data.url ?? null,
          }
        }
      } catch {
        /* skip */
      }
    }

    // Fallback: extract from DOM
    const title = document.querySelector('[data-automation="masthead_h1"]')?.textContent?.trim()
    const ratingEl = document.querySelector('[data-automation="bubbleRatingValue"]')
    const reviewCountEl = document.querySelector('[data-automation="bubbleReviewCount"]')

    return {
      name: title ?? null,
      rating: ratingEl?.textContent?.trim() ?? null,
      reviewCount: reviewCountEl?.textContent?.replace(/[(),reviews\s]/g, '').trim() ?? null,
      cuisine: null,
      priceRange: null,
      address: null,
      telephone: null,
      url: window.location.href,
    }
  })
}

async function getRestaurantReviews(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const section = document.querySelector('[data-automation="ugcRedesign"]')
    if (!section) return { count: 0, reviews: [] }

    const text = section.innerText

    // Extract rating breakdown
    const ratingMatch = text.match(
      /Excellent\n([\d,]+)\nGood\n([\d,]+)\nAverage\n([\d,]+)\nPoor\n([\d,]+)\nTerrible\n([\d,]+)/,
    )
    const breakdown = ratingMatch
      ? {
          excellent: Number.parseInt(ratingMatch[1].replace(/,/g, '')),
          good: Number.parseInt(ratingMatch[2].replace(/,/g, '')),
          average: Number.parseInt(ratingMatch[3].replace(/,/g, '')),
          poor: Number.parseInt(ratingMatch[4].replace(/,/g, '')),
          terrible: Number.parseInt(ratingMatch[5].replace(/,/g, '')),
        }
      : null

    // Extract sub-ratings
    const subRatings: Record<string, string> = {}
    const subRatingPattern = /(Food|Service|Value|Atmosphere)\n([\d.]+)/g
    let match: RegExpExecArray | null
    while ((match = subRatingPattern.exec(text))) {
      subRatings[match[1].toLowerCase()] = match[2]
    }

    // Extract AI summary
    const summaryMatch = text.match(/Reviews summary[\s\S]*?Powered by AI\n([\s\S]*?)(?=\n(?:Wrote|Show|Sort|Filter))/i)
    const aiSummary = summaryMatch?.[1]?.trim() ?? null

    return {
      breakdown,
      subRatings: Object.keys(subRatings).length > 0 ? subRatings : null,
      aiSummary,
    }
  })
}

/* ---------- Attraction operations ---------- */

async function searchAttractions(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const attractions: {
      name: string
      url: string
      locationId: string | null
    }[] = []
    const seen = new Set<string>()

    const links = document.querySelectorAll('a[href*="Attraction_Review"]')
    for (const a of links) {
      const el = a as HTMLAnchorElement
      const name = el.textContent?.trim() ?? ''
      if (name.length < 3 || name.length > 100 || seen.has(el.href)) continue
      seen.add(el.href)
      const idMatch = el.href.match(/-d(\d+)-/)
      attractions.push({
        name,
        url: el.href,
        locationId: idMatch?.[1] ?? null,
      })
    }

    return { count: attractions.length, attractions: attractions.slice(0, 30) }
  })
}

async function getAttractionDetail(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent!)
        if (data['@type'] === 'LocalBusiness' || data['@type'] === 'TouristAttraction') {
          return {
            name: data.name ?? null,
            rating: data.aggregateRating?.ratingValue ?? null,
            reviewCount: data.aggregateRating?.reviewCount ?? null,
            address: data.address
              ? {
                  street: data.address.streetAddress ?? null,
                  city: data.address.addressLocality ?? null,
                  region: data.address.addressRegion ?? null,
                  country: data.address.addressCountry ?? null,
                }
              : null,
            telephone: data.telephone ?? null,
            openingHours: data.openingHours ?? null,
            url: data.url ?? null,
            geo: data.geo
              ? { latitude: data.geo.latitude, longitude: data.geo.longitude }
              : null,
            images: Array.isArray(data.image) ? data.image.slice(0, 5) : [],
          }
        }
      } catch {
        /* skip */
      }
    }
    return null
  })
}

/* ---------- Search operation ---------- */

async function searchAll(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const results: { name: string; url: string; type: string }[] = []
    const seen = new Set<string>()

    const links = document.querySelectorAll(
      'a[href*="Hotel_Review"], a[href*="Restaurant_Review"], a[href*="Attraction_Review"], a[href*="Tourism-"]',
    )
    for (const a of links) {
      const el = a as HTMLAnchorElement
      const name = el.textContent?.trim() ?? ''
      if (name.length < 3 || name.length > 100 || seen.has(el.href)) continue
      seen.add(el.href)

      let type = 'other'
      if (el.href.includes('Hotel_Review')) type = 'hotel'
      else if (el.href.includes('Restaurant_Review')) type = 'restaurant'
      else if (el.href.includes('Attraction_Review')) type = 'attraction'
      else if (el.href.includes('Tourism-')) type = 'destination'

      results.push({ name, url: el.href, type })
    }

    return { count: results.length, results: results.slice(0, 30) }
  })
}

/* ---------- Adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> =
  {
    searchHotels,
    getHotelDetail,
    getHotelReviews,
    getHotelPrices,
    searchRestaurants,
    getRestaurantDetail,
    getRestaurantReviews,
    searchAttractions,
    getAttractionDetail,
    searchAll,
  }

const adapter: CodeAdapter = {
  name: 'tripadvisor-web',
  description: 'TripAdvisor — DOM/LD+JSON extraction for hotels, restaurants, attractions',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('tripadvisor.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // No auth required for public browsing
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
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
