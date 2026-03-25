/**
 * Expedia adapter — DOM/LD+JSON extraction from browser-rendered pages.
 *
 * Expedia uses PerimeterX bot detection — all data extracted via browser.
 * Hotel details from LD+JSON (Hotel schema in ItemList), search results from
 * data-stid lodging cards, activities/cars/deals from DOM.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright-core'

/* ---------- Hotel Search ---------- */

async function searchHotels(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('[data-stid="lodging-card-responsive"]')
    const hotels: {
      name: string
      url: string
      price: string | null
      rating: string | null
      ratingText: string | null
      reviewCount: string | null
      neighborhood: string | null
    }[] = []

    for (const card of cards) {
      const heading = card.querySelector('h3')
      const name = heading?.textContent?.trim()
      const link = card.querySelector('a[href*="Hotel-Information"]') as HTMLAnchorElement | null
      if (!name || !link) continue

      const text = card.textContent ?? ''
      const ratingMatch = text.match(/([\d.]+)\s*[\u5206/]*\s*(?:out of |共\s*)10/)
      const reviewMatch = text.match(/([\d,]+)\s*(?:reviews|条点评)/)
      const priceMatch = text.match(/\$([\d,]+)/)

      hotels.push({
        name,
        url: link.href,
        price: priceMatch ? `$${priceMatch[1]}` : null,
        rating: ratingMatch?.[1] ?? null,
        ratingText: null,
        reviewCount: reviewMatch?.[1]?.replace(/,/g, '') ?? null,
        neighborhood: card.querySelector('[data-stid="content-hotel-neighborhood"]')?.textContent?.trim() ?? null,
      })
    }

    return { count: hotels.length, hotels: hotels.slice(0, 30) }
  })
}

/* ---------- Hotel Detail ---------- */

async function getHotelDetail(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    // Extract from LD+JSON ItemList → Hotel objects
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent!)
        if (data['@type'] !== 'ItemList') continue
        const items = data.itemListElement ?? []
        const hotel = items[0]?.item
        if (!hotel || hotel['@type'] !== 'Hotel') continue
        return {
          name: hotel.name ?? null,
          starRating: hotel.starRating?.ratingValue ?? null,
          rating: hotel.aggregateRating?.ratingValue ?? null,
          reviewCount: hotel.aggregateRating?.reviewCount ?? null,
          address: hotel.address
            ? {
                street: hotel.address.streetAddress ?? null,
                city: hotel.address.addressLocality ?? null,
                region: hotel.address.addressRegion ?? null,
                postalCode: hotel.address.postalCode ?? null,
                country: hotel.address.addressCountry ?? null,
              }
            : null,
          amenities: (hotel.amenityFeature ?? [])
            .map((a: { name?: string }) => a.name)
            .filter(Boolean)
            .slice(0, 20),
          image: Array.isArray(hotel.image) ? hotel.image[0] : hotel.image ?? null,
        }
      } catch { /* skip */ }
    }

    // Fallback: DOM
    const title = document.querySelector('[data-stid="content-hotel-title"]')?.textContent?.trim()
    const addr = document.querySelector('[data-stid="content-hotel-address"]')?.textContent?.trim()
    return {
      name: title ?? document.title?.replace(/\s*\|.*$/, '').trim() ?? null,
      starRating: null,
      rating: null,
      reviewCount: null,
      address: addr ? { street: addr, city: null, region: null, postalCode: null, country: null } : null,
      amenities: [],
      image: null,
    }
  })
}

/* ---------- Hotel Reviews ---------- */

async function getHotelReviews(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const text = document.body.innerText ?? ''

    // Overall rating from the review summary section
    const reviewSection = document.querySelector('[data-stid="content-hotel-reviewsummary"], [data-stid="amenity-review-score"]')
    const reviewText = reviewSection?.textContent?.trim() ?? ''
    const scoreMatch = reviewText.match(/([\d.]+)\s*[/\u5206]/)

    // Review count
    const countMatch = text.match(/([\d,]+)\s*(?:reviews|条点评|verified reviews)/)

    // Try to find individual reviews
    const reviewEls = document.querySelectorAll('[itemprop="review"], [data-stid="content-item"]')
    const reviews: { text: string | null; rating: string | null }[] = []
    for (const el of [...reviewEls].slice(0, 10)) {
      const t = el.textContent?.trim()
      if (!t || t.length < 20) continue
      const rMatch = t.match(/([\d.]+)\s*\/\s*10/)
      reviews.push({
        text: t.slice(0, 300),
        rating: rMatch?.[1] ?? null,
      })
    }

    return {
      score: scoreMatch?.[1] ?? null,
      reviewCount: countMatch?.[1]?.replace(/,/g, '') ?? null,
      reviews,
    }
  })
}

/* ---------- Hotel Rooms ---------- */

async function getHotelRooms(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    // Look for room offer cards or sections
    const roomSections = document.querySelectorAll('[data-stid="property-offer-card"], [data-stid="section-room-list"] > div')
    const rooms: {
      name: string
      rating: string | null
      reviewCount: string | null
      price: string | null
      amenities: string[]
    }[] = []
    const seen = new Set<string>()

    // Parse room cards from the body text pattern
    const allText = document.body.innerText ?? ''
    // Room entries look like: "客房, 1 张特大床, 微波炉\n9.0\n..."
    const roomBlocks = allText.split(/(?=(?:客房|Room|Studio|Suite|King|Queen|Double|Standard|Deluxe),)/i)

    for (const block of roomBlocks.slice(0, 20)) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.length < 2) continue
      const name = lines[0]
      if (name.length > 120 || name.length < 5 || seen.has(name)) continue
      seen.add(name)

      const blockText = block
      const ratingMatch = blockText.match(/([\d.]+)\s*分/)
      const reviewMatch = blockText.match(/([\d,]+)\s*条点评/)
      const priceMatch = blockText.match(/\$([\d,]+)/)

      rooms.push({
        name,
        rating: ratingMatch?.[1] ?? null,
        reviewCount: reviewMatch?.[1]?.replace(/,/g, '') ?? null,
        price: priceMatch ? `$${priceMatch[1]}` : null,
        amenities: [],
      })
    }

    // Fallback: try structured approach
    if (rooms.length === 0) {
      for (const section of roomSections) {
        const heading = section.querySelector('h3, h4')?.textContent?.trim()
        if (!heading || seen.has(heading)) continue
        seen.add(heading)
        const sText = section.textContent ?? ''
        const pm = sText.match(/\$([\d,]+)/)
        rooms.push({
          name: heading,
          rating: null,
          reviewCount: null,
          price: pm ? `$${pm[1]}` : null,
          amenities: [],
        })
      }
    }

    return { count: rooms.length, rooms }
  })
}

/* ---------- Hotel Photos ---------- */

async function getHotelPhotos(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const imgs = document.querySelectorAll('img[src*="trvl-media.com"], img[src*="images.trvl-media"]')
    const photos = [...imgs]
      .map((img) => (img as HTMLImageElement).src || img.getAttribute('data-src'))
      .filter((src): src is string => !!src && src.includes('trvl-media.com'))
      .filter((src, i, arr) => arr.indexOf(src) === i) // dedupe
      .slice(0, 20)

    return { count: photos.length, photos }
  })
}

/* ---------- Hotel Location ---------- */

async function getHotelLocation(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const address = document.querySelector('[data-stid="content-hotel-address"]')?.textContent?.trim() ?? null

    // Nearby POIs from the location section
    const poiEls = document.querySelectorAll('[data-stid="content-item"]')
    const pois: { name: string; distance: string | null; type: string | null }[] = []

    for (const el of poiEls) {
      const text = el.textContent?.trim() ?? ''
      // Pattern: "Place, Name\n‪距离 X 分钟‬" or "Airport, Name\n‪驾车 X 分钟‬"
      const distMatch = text.match(/[‪]?(?:步行|驾车|Drive|Walk)\s*(\d+\s*(?:分钟|min|minutes?))[‬]?/i)
      const nameMatch = text.match(/(?:Place|Airport|Station|Transit),?\s*(.+?)(?:\n|$)/)
      if (nameMatch) {
        pois.push({
          name: nameMatch[1].trim(),
          distance: distMatch?.[1]?.trim() ?? null,
          type: text.match(/^(Place|Airport|Station|Transit)/)?.[1] ?? null,
        })
      }
    }

    return { address, pois: pois.slice(0, 15) }
  })
}

/* ---------- Hotel FAQ ---------- */

async function getHotelFAQ(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    // Look for LD+JSON FAQPage
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent!)
        if (data['@type'] !== 'FAQPage') continue
        const entities = data.mainEntity ?? []
        const questions = entities.map((e: { name?: string; acceptedAnswer?: { text?: string } }) => ({
          question: e.name ?? null,
          answer: e.acceptedAnswer?.text?.slice(0, 300) ?? null,
        }))
        return { count: questions.length, questions }
      } catch { /* skip */ }
    }

    // Fallback: DOM
    const faqSection = document.querySelector('[data-stid="answering-traveller-questions"]')
    if (!faqSection) return { count: 0, questions: [] }
    const items = faqSection.querySelectorAll('h3, h4')
    const questions = [...items].map((el) => ({
      question: el.textContent?.trim() ?? null,
      answer: null,
    }))
    return { count: questions.length, questions }
  })
}

/* ---------- Search Activities ---------- */

async function searchActivities(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const text = document.body.innerText ?? ''
    const activities: {
      name: string
      duration: string | null
      rating: string | null
      price: string | null
      category: string | null
    }[] = []

    // Activity cards follow pattern: "第 N 位 NAME\n持续时间：...\nN.N\n$..."
    const sections = text.split(/第\s*\d+\s*位\s*/)
    for (const section of sections.slice(1, 31)) {
      const lines = section.split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.length < 2) continue
      const name = lines[0]
      if (name.length > 150 || name.length < 3) continue

      const sectionText = section
      const durationMatch = sectionText.match(/(?:持续时间|Duration)[：:]\s*(.+?)(?:\n|$)/i)
      const ratingMatch = sectionText.match(/([\d.]+)\s*分/)
      const priceMatch = sectionText.match(/\$([\d,]+)/)

      activities.push({
        name,
        duration: durationMatch?.[1]?.trim() ?? null,
        rating: ratingMatch?.[1] ?? null,
        price: priceMatch ? `$${priceMatch[1]}` : null,
        category: null,
      })
    }

    // Total count from page text
    const totalMatch = text.match(/([\d,]+)\s*项旅游活动/)
    return {
      totalCount: totalMatch ? parseInt(totalMatch[1].replace(/,/g, ''), 10) : activities.length,
      activities,
    }
  })
}

/* ---------- Search Car Rentals ---------- */

async function searchCarRentals(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('[data-stid="car-offer-card"]')
    const cars: {
      name: string
      type: string | null
      passengers: string | null
      price: string | null
      provider: string | null
    }[] = []

    for (const card of cards) {
      const text = card.textContent?.trim() ?? ''
      const heading = card.querySelector('h3, h4, [class*="title"]')
      const name = heading?.textContent?.trim() ?? text.split('\n')[0]?.trim()
      if (!name || name.length > 120) continue

      const priceMatch = text.match(/\$([\d,]+)/)
      const passengerMatch = text.match(/(\d+)\s*(?:passengers|位乘客|人)/)

      cars.push({
        name,
        type: null,
        passengers: passengerMatch?.[1] ?? null,
        price: priceMatch ? `$${priceMatch[1]}` : null,
        provider: null,
      })
    }

    return { count: cars.length, cars: cars.slice(0, 30) }
  })
}

/* ---------- Get Deals ---------- */

async function getDeals(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const deals: {
      name: string
      location: string | null
      rating: string | null
      price: string | null
      originalPrice: string | null
    }[] = []

    // Deal cards are in carousels with lodging-card-responsive or similar structure
    const cards = document.querySelectorAll('[data-stid="lodging-card-responsive"], [data-stid="carousel-item"]')
    for (const card of cards) {
      const heading = card.querySelector('h3, h4')
      const name = heading?.textContent?.trim()
      if (!name || name.length > 120) continue

      const text = card.textContent ?? ''
      const ratingMatch = text.match(/([\d.]+)\s*分/)
      const priceMatch = text.match(/\$([\d,]+)/)
      const origMatch = text.match(/\$(\d[\d,]+)\s*(?:总价含税费|total)/)

      // Location text
      const locEl = card.querySelector('p, [class*="subtitle"]')
      const location = locEl?.textContent?.trim() ?? null

      deals.push({
        name,
        location: location !== name ? location : null,
        rating: ratingMatch?.[1] ?? null,
        price: priceMatch ? `$${priceMatch[1]}` : null,
        originalPrice: origMatch ? `$${origMatch[1]}` : null,
      })
    }

    return { count: deals.length, deals: deals.slice(0, 30) }
  })
}

/* ---------- Adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> =
  {
    searchHotels,
    getHotelDetail,
    getHotelReviews,
    getHotelRooms,
    getHotelPhotos,
    getHotelLocation,
    getHotelFAQ,
    searchActivities,
    searchCarRentals,
    getDeals,
  }

const adapter: CodeAdapter = {
  name: 'expedia-web',
  description: 'Expedia — DOM/LD+JSON extraction for hotel search, details, reviews, rooms, activities, car rentals, deals',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('expedia.com')
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
