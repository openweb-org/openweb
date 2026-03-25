/**
 * Redfin L3 adapter — DOM extraction of structured data from Redfin pages.
 *
 * Redfin embeds rich Schema.org JSON-LD in every page. We extract:
 * - Search listings from application/ld+json Product pairs
 * - Property details from RealEstateListing JSON-LD
 * - Redfin Estimate from the AVM section DOM text
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'

/* ---------- operation handlers ---------- */

async function searchHomes(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    const listings: Record<string, unknown>[] = []
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent!)
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
        const data = JSON.parse(s.textContent!)
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

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchHomes,
  getPropertyDetails,
  getRedfinEstimate,
}

const adapter: CodeAdapter = {
  name: 'redfin-dom',
  description: 'Redfin — home search, property details, and Redfin Estimate via JSON-LD and DOM extraction',

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
