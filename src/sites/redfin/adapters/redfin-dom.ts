import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
/**
 * Redfin L3 adapter — DOM extraction of structured data from Redfin pages.
 *
 * Redfin embeds rich Schema.org JSON-LD in every page. We extract:
 * - Search listings from application/ld+json Product pairs
 * - Property details from RealEstateListing JSON-LD
 * - Redfin Estimate from the AVM section DOM text
 * - Listing photos from JSON-LD ImageObject entries
 * - Price/sale history from .PropertyHistory section
 * - Market insights from market-insights section
 * - Similar homes from .SimilarHomeCardReact cards
 */
import type { CodeAdapter } from '../../../types/adapter.js'

/* ---------- operation handlers ---------- */

async function searchHomes(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const listings: Record<string, unknown>[] = []
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (!Array.isArray(data) || data.length !== 2) continue
        const residence = data[0]
        const product = data[1]
        if (!product || product['@type'] !== 'Product') continue
        const addr = residence.address || {}
        const geo = residence.geo || {}
        const floor = residence.floorSize || {}
        const offer = product.offers || {}
        listings.push({
          name: residence.name || '',
          url: residence.url || product.url || '',
          streetAddress: addr.streetAddress || '',
          city: addr.addressLocality || '',
          state: addr.addressRegion || '',
          zip: addr.postalCode || '',
          latitude: geo.latitude || null,
          longitude: geo.longitude || null,
          rooms: residence.numberOfRooms || null,
          sqft: floor.value || null,
          price: Number(offer.price) || null,
          currency: offer.priceCurrency || 'USD',
          propertyType: residence['@type'] || '',
        })
      } catch { /* skip malformed JSON-LD blocks */ }
    }
    const meta = document.querySelector('meta[name="description"]')
    const description = meta ? meta.getAttribute('content') : ''
    return { resultCount: listings.length, description, listings }
  })
}

async function getPropertyDetails(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (!data['@type'] || !Array.isArray(data['@type'])) continue
        if (!data['@type'].includes('RealEstateListing')) continue
        const entity = data.mainEntity || {}
        const addr = entity.address || {}
        const geo = entity.geo || {}
        const floor = entity.floorSize || {}
        const offer = data.offers || {}
        const amenities = (entity.amenityFeature || []).map((a: any) => a.name || '')
        const images = (entity.image || []).map((img: any) =>
          typeof img === 'string' ? img : img.url || '',
        )
        return {
          name: data.name || '',
          description: (data.description || '').replace(/&[a-z]+;/g, ' ').trim(),
          url: data.url || '',
          datePosted: data.datePosted || '',
          streetAddress: addr.streetAddress || '',
          city: addr.addressLocality || '',
          state: addr.addressRegion || '',
          zip: addr.postalCode || '',
          latitude: geo.latitude || null,
          longitude: geo.longitude || null,
          bedrooms: entity.numberOfBedrooms || null,
          bathrooms: entity.numberOfBathroomsTotal || null,
          sqft: floor.value || null,
          yearBuilt: entity.yearBuilt || null,
          propertyType: entity.accommodationCategory || entity['@type'] || '',
          price: Number(offer.price) || null,
          currency: offer.priceCurrency || 'USD',
          availability: offer.availability || '',
          amenities,
          imageCount: images.length,
          primaryImage: images[0] || '',
        }
      } catch { /* skip malformed JSON-LD blocks */ }
    }
    return null
  })
}

async function getRedfinEstimate(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const section = document.querySelector(
      '[data-rf-test-id="avm-section-expandable-preview"], .RedfinEstimateSection__Section, .avmInfo',
    )
    if (!section) return { estimate: null, message: 'No Redfin Estimate section found on this page.' }

    const text = section.innerText || ''
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    const titleLine = lines.find((l) => /Redfin Estimate for/i.test(l)) || ''
    const address = titleLine.replace(/Redfin Estimate for\s*/i, '').trim()
    const priceMatch = text.match(/Redfin Estimate[^\n]*\n\s*(\$[\d,]+)/)
    const estimatePrice = priceMatch ? priceMatch[1] : null

    const compText = text.match(
      /uses (\d+) recent nearby sales, priced between (\$[\w.,]+\s+to\s+\$[\w.,]+)/,
    )
    const compCount = compText ? Number(compText[1]) : null
    const compRange = compText ? compText[2].replace(/\.$/, '').trim() : null

    const comparables: Record<string, unknown>[] = []
    const soldBlocks = text.split(/SOLD [A-Z]{3} \d{1,2}, \d{4}/)
    for (let i = 1; i < soldBlocks.length && i <= 6; i++) {
      const block = soldBlocks[i]
      const priceM = block.match(/\$([\d,]+)/)
      const bedsM = block.match(/(\d+)\s*beds?/)
      const bathsM = block.match(/([\d.]+)\s*baths?/)
      const sqftM = block.match(/([\d,]+)\s*sq\s*ft/)
      const addrM = block.match(
        /\d+[^$\n]+(?:Ave|St|Dr|Rd|Blvd|Ct|Ln|Way|Pl|Cir)[^,\n]*,\s*[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5}/,
      )
      comparables.push({
        soldPrice: priceM ? `$${priceM[1]}` : null,
        beds: bedsM ? Number(bedsM[1]) : null,
        baths: bathsM ? Number(bathsM[1]) : null,
        sqft: sqftM ? Number(sqftM[1].replace(/,/g, '')) : null,
        address: addrM ? addrM[0].trim() : null,
      })
    }

    return {
      address,
      estimatePrice,
      comparableCount: compCount,
      comparablePriceRange: compRange,
      comparables,
    }
  })
}

async function getListingPhotos(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent ?? '')
        if (!data['@type'] || !Array.isArray(data['@type'])) continue
        if (!data['@type'].includes('RealEstateListing')) continue
        const entity = data.mainEntity || {}
        const images = (entity.image || []).map((img: any) => {
          if (typeof img === 'string') return { url: img }
          return { url: img.url || '', width: img.width || null, height: img.height || null }
        })
        return {
          address: data.name || '',
          url: data.url || '',
          photoCount: images.length,
          photos: images,
        }
      } catch { /* skip malformed JSON-LD blocks */ }
    }
    return { photoCount: 0, photos: [], message: 'No listing photos found on this page.' }
  })
}

async function getPriceHistory(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const section = document.querySelector('.PropertyHistory')
    if (!section) return { events: [], message: 'No price history section found on this page.' }

    const text = section.innerText || ''
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

    // Find the address from the heading
    const heading = lines.find((l) => /sale and tax history for/i.test(l)) || ''
    const address = heading.replace(/sale and tax history for\s*/i, '').trim()

    // Parse sale history events: Date / Event / Source / Price / Price-per-sqft
    const events: Record<string, unknown>[] = []
    const dateIdx = lines.indexOf('Price') // header row ends with "Price"
    if (dateIdx >= 0) {
      const dataLines = lines.slice(dateIdx + 1)
      const dateRegex = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/
      let i = 0
      while (i < dataLines.length) {
        if (dateRegex.test(dataLines[i])) {
          const date = dataLines[i]
          const event = dataLines[i + 1] || ''
          // Source line (MLS info) — may or may not be present
          let source: string | null = null
          let price: string | null = null
          let pricePerSqft: string | null = null
          let j = i + 2
          // Collect remaining fields until next date or end
          while (j < dataLines.length && !dateRegex.test(dataLines[j])) {
            const val = dataLines[j]
            if (/^\$[\d,]+$/.test(val)) price = val
            else if (/^\$[\d,]+\/sq ft$/.test(val)) pricePerSqft = val
            else if (!price && !pricePerSqft) source = val
            j++
          }
          events.push({ date, event, source, price, pricePerSqft })
          i = j
        } else {
          i++
        }
      }
    }

    return { address, eventCount: events.length, events }
  })
}

async function getMarketInsights(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const section = document.querySelector('[data-rf-test-id="market-insights-expandable-preview"]')
    if (!section) return { message: 'No market insights section found on this page.' }

    const text = section.innerText || ''
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

    // First meaningful line is usually "X is a seller's/buyer's market"
    const marketLine = lines.find((l) => /is a (seller|buyer)/i.test(l)) || ''
    const neighborhoodMatch = marketLine.match(/^(.+?) is a/i)
    const neighborhood = neighborhoodMatch ? neighborhoodMatch[1] : ''
    const marketType = /seller/i.test(marketLine) ? 'seller' : /buyer/i.test(marketLine) ? 'buyer' : 'neutral'
    const summary = lines.find((l) => /inventory|competition|balanced/i.test(l)) || ''

    // Extract key metrics
    const offerLine = lines.find((l) => /offer insight/i.test(l)) || ''
    const listToSaleLine = lines.find((l) => /list to sale/i.test(l)) || ''
    const listToSaleMatch = listToSaleLine.match(/about (\d+)% (above|below)/i)
    const listToSalePercent = listToSaleMatch ? `${listToSaleMatch[1]}% ${listToSaleMatch[2]} list` : null
    const timeLine = lines.find((l) => /time on market/i.test(l)) || ''
    const timeMatch = timeLine.match(/around (\d+) days/i)
    const daysOnMarket = timeMatch ? Number(timeMatch[1]) : null

    return {
      neighborhood,
      marketType,
      summary,
      offerInsight: offerLine.replace(/^offer insight:\s*/i, '').trim() || null,
      listToSalePrice: listToSalePercent,
      averageDaysOnMarket: daysOnMarket,
    }
  })
}

async function getSimilarHomes(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const section = document.querySelector('[data-rf-test-id="similarsSection"]')
    if (!section) return { homeCount: 0, homes: [], message: 'No similar homes section found on this page.' }

    const cards = section.querySelectorAll('.SimilarHomeCardReact')
    const homes: Record<string, unknown>[] = []
    for (const card of cards) {
      const lines = (card as HTMLElement).innerText.split('\n').map((l) => l.trim()).filter(Boolean)
      const link = card.querySelector('a')
      const priceLine = lines.find((l) => /^\$[\d,]+/.test(l))
      const bedsLine = lines.find((l) => /beds?$/i.test(l))
      const bathsLine = lines.find((l) => /baths?$/i.test(l))
      const sqftLine = lines.find((l) => /sq ft$/i.test(l))
      // Address is typically the line with city, state, zip pattern
      const addrLine = lines.find((l) => /,\s*[A-Z]{2}\s+\d{5}/.test(l))

      homes.push({
        price: priceLine || null,
        beds: bedsLine ? Number(bedsLine.match(/(\d+)/)?.[1]) : null,
        baths: bathsLine ? Number(bathsLine.match(/([\d.]+)/)?.[1]) : null,
        sqft: sqftLine ? Number(sqftLine.replace(/,/g, '').match(/(\d+)/)?.[1]) : null,
        address: addrLine || null,
        url: link?.href || null,
      })
    }

    return { homeCount: homes.length, homes }
  })
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchHomes,
  getPropertyDetails,
  getRedfinEstimate,
  getListingPhotos,
  getPriceHistory,
  getMarketInsights,
  getSimilarHomes,
}

const adapter: CodeAdapter = {
  name: 'redfin-dom',
  description: 'Redfin — home search, property details, estimate, photos, history, market insights, similar homes via JSON-LD and DOM extraction',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('redfin.com')
  },

  async isAuthenticated(): Promise<boolean> {
    return true // Redfin is public, no auth required
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) throw OpenWebError.unknownOp(operation)
      return await handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
