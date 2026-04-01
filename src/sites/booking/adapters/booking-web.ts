import type { Page } from 'playwright-core'

// Self-contained types — avoid external imports so adapter works from compile cache
interface CodeAdapter {
  readonly name: string
  readonly description: string
  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown>
}

function unknownOpError(op: string): Error {
  return Object.assign(new Error(`Unknown operation: ${op}`), { failureClass: 'fatal' })
}

/**
 * Booking.com adapter — DOM/LD+JSON extraction from browser-rendered pages.
 *
 * Hotels: www.booking.com — search via data-testid property cards,
 * detail via LD+JSON Hotel schema, reviews/prices/facilities from DOM.
 * Flights: flights.booking.com — search results via data-testid flight cards.
 */

/* ---------- Hotel search ---------- */

async function searchHotels(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('[data-testid="property-card"]')
    const hotels: {
      name: string
      url: string
      price: string | null
      rating: string | null
      ratingText: string | null
      reviewCount: string | null
      distance: string | null
    }[] = []

    for (const card of cards) {
      const title = card.querySelector('[data-testid="title"]')?.textContent?.trim()
      const link = card.querySelector('a[data-testid="title-link"]') as HTMLAnchorElement | null
      if (!title || !link) continue

      const reviewEl = card.querySelector('[data-testid="review-score"]')
      const reviewText = reviewEl?.textContent?.trim() ?? ''
      const scoreMatch = reviewText.match(/Scored\s+([\d.]+)\s+([\d.]+)\s*([A-Za-z ]+?)\s+([\d,]+)\s*reviews/)

      hotels.push({
        name: title,
        url: link.href,
        price: card.querySelector('[data-testid="price-and-discounted-price"]')?.textContent?.trim() ?? null,
        rating: scoreMatch?.[2] ?? null,
        ratingText: scoreMatch?.[3]?.trim() ?? null,
        reviewCount: scoreMatch?.[4]?.replace(/,/g, '') ?? null,
        distance: card.querySelector('[data-testid="distance"]')?.textContent?.trim() ?? null,
      })
    }

    return { count: hotels.length, hotels: hotels.slice(0, 30) }
  })
}

/* ---------- Hotel detail ---------- */

async function getHotelDetail(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (data['@type'] !== 'Hotel') continue
        return {
          name: data.name ?? null,
          description: data.description ?? null,
          rating: data.aggregateRating?.ratingValue ?? null,
          reviewCount: data.aggregateRating?.reviewCount ?? null,
          priceRange: data.priceRange ?? null,
          address: data.address
            ? {
                street: data.address.streetAddress ?? null,
                city: data.address.addressLocality ?? null,
                region: data.address.addressRegion ?? null,
                postalCode: data.address.postalCode ?? null,
                country: data.address.addressCountry ?? null,
              }
            : null,
          image: data.image ?? null,
          url: data.url ?? null,
        }
      } catch {
        /* skip non-parseable LD+JSON */
      }
    }

    // Fallback: DOM extraction
    const desc = document.querySelector('[data-testid="property-description"]')?.textContent?.trim()
    const addr = document.querySelector('[data-testid="PropertyHeaderAddressDesktop-wrapper"]')?.textContent?.trim()
    return {
      name: document.title?.replace(/ \|.*$/, '').replace(/,.*$/, '').trim() ?? null,
      description: desc ?? null,
      rating: null,
      reviewCount: null,
      priceRange: null,
      address: addr ? { street: addr, city: null, region: null, postalCode: null, country: null } : null,
      image: null,
      url: window.location.href,
    }
  })
}

/* ---------- Hotel reviews ---------- */

async function getHotelReviews(page: Page, _params: Record<string, unknown>): Promise<unknown> {
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

/* ---------- Hotel prices (room availability) ---------- */

async function getHotelPrices(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const table = document.querySelector('table.hprt-table')
    if (!table) return { count: 0, rooms: [] }

    const seen = new Set<string>()
    const rooms: {
      name: string
      bed: string | null
      size: string | null
      facilities: string[]
      price: string | null
      perNight: string | null
    }[] = []

    for (const row of table.querySelectorAll('tr.js-rt-block-row')) {
      const name = row.querySelector('.hprt-roomtype-icon-link')?.textContent?.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)

      const bed = row.querySelector('.hprt-roomtype-bed')?.textContent?.trim() ?? null
      const size = row.querySelector('.hprt-roomtype-room-size')?.textContent?.trim() ?? null
      const facilities = [...row.querySelectorAll('.hprt-facilities-facility')]
        .map((f) => f.textContent?.trim() ?? '')
        .filter(Boolean)
        .slice(0, 8)

      const rowText = row.textContent ?? ''
      const priceMatch = rowText.match(/\$([\d,]+)\s*Price/)
      const perNightMatch = rowText.match(/\$([\d,]+)\s*per night/)

      rooms.push({
        name,
        bed,
        size,
        facilities,
        price: priceMatch ? `$${priceMatch[1]}` : null,
        perNight: perNightMatch ? `$${perNightMatch[1]}` : null,
      })
    }

    return { count: rooms.length, rooms }
  })
}

/* ---------- Flights search ---------- */

async function searchFlights(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('[data-testid="searchresults_card"]')
    const flights: {
      carrier: string | null
      departureTime: string | null
      arrivalTime: string | null
      departureAirport: string | null
      arrivalAirport: string | null
      duration: string | null
      stops: string | null
      price: string | null
    }[] = []

    for (const card of cards) {
      const carrier = card.querySelector('[data-testid="flight_card_carriers"]')?.textContent?.trim() ?? null
      const depTime = card.querySelector('[data-testid="flight_card_segment_departure_time_0"]')?.textContent?.trim() ?? null
      const arrTime = card.querySelector('[data-testid="flight_card_segment_destination_time_0"]')?.textContent?.trim() ?? null
      const depAirport = card.querySelector('[data-testid="flight_card_segment_departure_airport_0"]')?.textContent?.trim() ?? null
      const arrAirport = card.querySelector('[data-testid="flight_card_segment_destination_airport_0"]')?.textContent?.trim() ?? null
      const duration = card.querySelector('[data-testid="flight_card_segment_duration_0"]')?.textContent?.trim() ?? null
      const stops = card.querySelector('[data-testid="flight_card_segment_stops_0"]')?.textContent?.trim() ?? null

      // Price from the upt_price element
      const priceEl = card.querySelector('[data-testid="upt_price"]')
      const priceText = priceEl?.textContent?.trim() ?? ''
      const priceMatch = priceText.match(/\$[\d,]+/)

      flights.push({
        carrier,
        departureTime: depTime,
        arrivalTime: arrTime,
        departureAirport: depAirport,
        arrivalAirport: arrAirport,
        duration,
        stops,
        price: priceMatch?.[0] ?? null,
      })
    }

    return { count: flights.length, flights: flights.slice(0, 30) }
  })
}

/* ---------- Adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchHotels,
  getHotelDetail,
  getHotelReviews,
  getHotelPrices,
  searchFlights,
}

const adapter: CodeAdapter = {
  name: 'booking-web',
  description: 'Booking.com — DOM/LD+JSON extraction for hotel search, details, reviews, pricing, flights',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('booking.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // Public browsing works without auth
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) throw unknownOpError(operation)
    return handler(page, { ...params })
  },
}

export default adapter
