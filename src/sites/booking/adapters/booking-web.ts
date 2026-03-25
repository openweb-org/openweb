/**
 * Booking.com adapter — DOM/LD+JSON extraction from browser-rendered pages.
 *
 * Booking.com uses GraphQL at /dml/graphql with bot detection.
 * All data extracted via browser. Hotel details from LD+JSON (Hotel schema),
 * search results from data-testid property cards, reviews/rooms/facilities from DOM.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright-core'

/* ---------- Search operations ---------- */

async function searchProperties(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('[data-testid="property-card"]')
    const properties: {
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
      const scoreMatch = reviewText.match(/Scored ([\d.]+)\s+([\d.]+)\s*([A-Za-z ]+?)\s+([\d,]+)\s*reviews/)

      properties.push({
        name: title,
        url: link.href,
        price: card.querySelector('[data-testid="price-and-discounted-price"]')?.textContent?.trim() ?? null,
        rating: scoreMatch?.[2] ?? null,
        ratingText: scoreMatch?.[3]?.trim() ?? null,
        reviewCount: scoreMatch?.[4]?.replace(/,/g, '') ?? null,
        distance: card.querySelector('[data-testid="distance"]')?.textContent?.trim() ?? null,
      })
    }

    return { count: properties.length, properties: properties.slice(0, 30) }
  })
}

async function searchAll(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const results: { name: string; url: string; type: string }[] = []
    const seen = new Set<string>()

    const links = document.querySelectorAll('a[href*="/hotel/"], a[href*="/flights/"], a[href*="/cars/"]')
    for (const a of links) {
      const el = a as HTMLAnchorElement
      const name = el.textContent?.trim() ?? ''
      if (name.length < 3 || name.length > 100 || seen.has(el.href)) continue
      seen.add(el.href)

      let type = 'other'
      if (el.href.includes('/hotel/')) type = 'hotel'
      else if (el.href.includes('/flights/')) type = 'flight'
      else if (el.href.includes('/cars/')) type = 'car_rental'

      results.push({ name, url: el.href, type })
    }

    return { count: results.length, results: results.slice(0, 30) }
  })
}

/* ---------- Property detail operations ---------- */

async function getPropertyDetail(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    // Extract from LD+JSON Hotel schema
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent!)
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
        /* skip */
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

async function getPropertyReviews(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    // Overall score
    const scoreComponent = document.querySelector('[data-testid="review-score-component"]')
    const scoreText = scoreComponent?.textContent?.trim() ?? ''
    const scoreMatch = scoreText.match(/Scored ([\d.]+)\s+([\d.]+)/)
    const countMatch = scoreText.match(/([\d,]+)\s*reviews/)

    // Category subscores
    const subscores: Record<string, string> = {}
    const subscoreEls = document.querySelectorAll('[data-testid="review-subscore"]')
    for (const el of subscoreEls) {
      const text = el.textContent?.trim() ?? ''
      const match = text.match(/^(.+?)\s*([\d.]+)$/)
      if (match) {
        const key = match[1].toLowerCase().replace(/\s+/g, '_')
        subscores[key] = match[2]
      }
    }

    // Featured reviews
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

async function getPropertyRooms(page: Page, _params: Record<string, unknown>): Promise<unknown> {
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

    const rows = table.querySelectorAll('tr.js-rt-block-row')
    for (const row of rows) {
      const roomTypeCell = row.querySelector('.hprt-roomtype-icon-link')
      const name = roomTypeCell?.textContent?.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)

      const bed = row.querySelector('.hprt-roomtype-bed')?.textContent?.trim() ?? null
      const size = row.querySelector('.hprt-roomtype-room-size')?.textContent?.trim() ?? null
      const facilitiesEls = row.querySelectorAll('.hprt-facilities-facility')
      const facilities = [...facilitiesEls].map((f) => f.textContent?.trim() ?? '').filter(Boolean).slice(0, 8)

      // Price from the row text
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

async function getPropertyFacilities(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    // Popular amenities
    const wrapper = document.querySelector('[data-testid="property-most-popular-facilities-wrapper"]')
    const seen = new Set<string>()
    const popular: string[] = []
    if (wrapper) {
      for (const span of wrapper.querySelectorAll('span')) {
        const text = span.textContent?.trim()
        if (text && text.length > 2 && !text.includes('See all') && !text.includes('Most popular') && !seen.has(text)) {
          seen.add(text)
          popular.push(text)
        }
      }
    }

    // Full facilities from the facilities section
    const facSection = document.querySelector('#hp_facilities_box, [data-testid="property-facilities-block-container"]')
    const allFacilities: string[] = []
    if (facSection) {
      const items = facSection.querySelectorAll('li, [data-testid="facility-icon"]')
      for (const item of items) {
        const text = item.textContent?.trim()
        if (text && text.length > 1 && !allFacilities.includes(text)) {
          allFacilities.push(text)
        }
      }
    }

    return {
      popular,
      all: allFacilities.length > 0 ? allFacilities.slice(0, 50) : null,
      totalCount: allFacilities.length || null,
    }
  })
}

async function getPropertyLocation(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    // POIs
    const poiEls = document.querySelectorAll('[data-testid="poi-block-list"] li, [data-testid="poi-block"] li')
    const pois = [...poiEls].slice(0, 15).map((el) => {
      const text = el.textContent?.trim() ?? ''
      const match = text.match(/^(.+?)([\d,.]+\s*(?:ft|mi|km|m|miles))$/)
      return match
        ? { name: match[1].trim(), distance: match[2].trim() }
        : { name: text, distance: null }
    })

    // Location score
    const locationScore = document
      .querySelector('[data-testid="property-description-location-score-trans"]')
      ?.textContent?.trim() ?? null

    // Coordinates from static map (may be background-image or img src)
    let coordinates: { latitude: string; longitude: string } | null = null
    const mapEntry = document.querySelector('[data-testid="map-entry-point-desktop"] div[style*="maps.googleapis.com"]') as HTMLElement | null
    const mapImg = document.querySelector('img[src*="maps.googleapis.com"]') as HTMLImageElement | null
    const mapSrc = mapEntry?.style.backgroundImage || mapImg?.src || ''
    const coordMatch = mapSrc.match(/center=([\d.-]+),([\d.-]+)/)
    if (coordMatch) coordinates = { latitude: coordMatch[1], longitude: coordMatch[2] }

    // Address
    const address = document.querySelector('[data-testid="PropertyHeaderAddressDesktop-wrapper"]')?.textContent?.trim() ?? null

    return { address, locationScore, coordinates, pois }
  })
}

async function getPropertyPhotos(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const gallery = document.querySelector('[data-testid="GalleryUnifiedDesktop-wrapper"]')
    const imgs = gallery?.querySelectorAll('img') ?? document.querySelectorAll('[data-testid="image"] img')

    const photos = [...imgs]
      .map((img) => img.src || img.getAttribute('data-src'))
      .filter((src): src is string => !!src && src.includes('bstatic.com'))
      .slice(0, 20)

    return { count: photos.length, photos }
  })
}

async function getPropertyHouseRules(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const wrapper = document.querySelector('[data-testid="HouseRules-wrapper"]')
    if (!wrapper) return null

    const text = wrapper.textContent?.trim() ?? ''

    const checkInMatch = text.match(/Check-in\s*From\s*([\d:]+\s*[AP]M)/)
    const checkOutMatch = text.match(/Check-out\s*Until\s*([\d:]+\s*[AP]M)/)
    const cancellationMatch = text.match(/Cancellation\/ prepayment\s*([\s\S]*?)(?=Children|Damage|$)/)

    return {
      checkIn: checkInMatch?.[1] ?? null,
      checkOut: checkOutMatch?.[1] ?? null,
      cancellation: cancellationMatch?.[1]?.trim()?.slice(0, 200) ?? null,
      fullText: text.slice(0, 500),
    }
  })
}

async function getPropertyFAQ(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const leftCard = document.querySelector('[data-testid="faq-accordion-left-card"]')
    const rightCard = document.querySelector('[data-testid="faq-accordion-right-card"]')

    const extractQuestions = (card: Element | null): string[] => {
      if (!card) return []
      // innerText preserves line breaks; textContent does not
      return (card as HTMLElement).innerText
        ?.split('\n')
        .map((l) => l.trim())
        .filter((l) => l.endsWith('?')) ?? []
    }

    const questions = [...extractQuestions(leftCard), ...extractQuestions(rightCard)]
    return { count: questions.length, questions }
  })
}

/* ---------- Adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> =
  {
    searchProperties,
    searchAll,
    getPropertyDetail,
    getPropertyReviews,
    getPropertyRooms,
    getPropertyFacilities,
    getPropertyLocation,
    getPropertyPhotos,
    getPropertyHouseRules,
    getPropertyFAQ,
  }

const adapter: CodeAdapter = {
  name: 'booking-web',
  description: 'Booking.com — DOM/LD+JSON extraction for hotel search, details, reviews, rooms, facilities',

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
    if (!handler) throw new Error(`Unknown operation: ${operation}`)
    return handler(page, { ...params })
  },
}

export default adapter
