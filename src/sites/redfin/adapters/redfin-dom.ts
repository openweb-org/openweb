import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
import type { CodeAdapter } from '../../../types/adapter.js'

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
    // Fallback: extract basic info from meta tags and page content
    const title = document.querySelector('title')?.textContent || ''
    const meta = document.querySelector('meta[name="description"]')
    const desc = meta ? meta.getAttribute('content') || '' : ''
    return {
      name: title.replace(/ \| Redfin$/, ''),
      description: desc,
      url: window.location.href,
      datePosted: '',
      streetAddress: '',
      city: '',
      state: '',
      zip: '',
      latitude: null,
      longitude: null,
      bedrooms: null,
      bathrooms: null,
      sqft: null,
      yearBuilt: null,
      propertyType: '',
      price: null,
      currency: 'USD',
      availability: '',
      amenities: [],
      imageCount: 0,
      primaryImage: '',
    }
  })
}

async function getMarketData(page: Page, _params: Record<string, unknown>): Promise<unknown> {
  return page.evaluate(() => {
    // Try the housing-market page structure first
    const text = document.body.innerText || ''

    // Extract key metrics from the housing market page
    const medianMatch = text.match(/median sale price.*?\$([\d,]+)/i)
    const medianPrice = medianMatch ? `$${medianMatch[1]}` : null

    const homeSoldMatch = text.match(/([\d,]+)\s*(?:homes?\s*)?(?:were\s+)?sold/i)
    const homesSold = homeSoldMatch ? Number(homeSoldMatch[1].replace(/,/g, '')) : null

    const medianDomMatch = text.match(/median days on (?:the )?market.*?(\d+)/i)
    const medianDaysOnMarket = medianDomMatch ? Number(medianDomMatch[1]) : null

    const yoyMatch = text.match(/(up|down)\s+([\d.]+)%\s+since last year/i)
    const yoyDirection = yoyMatch ? yoyMatch[1].toLowerCase() : null
    const yoyPercent = yoyMatch ? Number(yoyMatch[2]) : null

    const saleToListMatch = text.match(/sale-to-list.*?([\d.]+)%/i)
    const saleToListPercent = saleToListMatch ? Number(saleToListMatch[1]) : null

    // Market competitiveness
    const competitiveMatch = text.match(/(very competitive|competitive|somewhat competitive|not very competitive)/i)
    const competitiveness = competitiveMatch ? competitiveMatch[1] : null

    // Try market insights section on property pages
    const section = document.querySelector('[data-rf-test-id="market-insights-expandable-preview"]')
    let neighborhood: string | null = null
    let marketType: string | null = null
    let summary: string | null = null

    if (section) {
      const sectionText = (section as HTMLElement).innerText || ''
      const lines = sectionText.split('\n').map((l) => l.trim()).filter(Boolean)
      const marketLine = lines.find((l) => /is a (seller|buyer)/i.test(l)) || ''
      const neighborhoodMatch = marketLine.match(/^(.+?) is a/i)
      neighborhood = neighborhoodMatch ? neighborhoodMatch[1] : null
      marketType = /seller/i.test(marketLine) ? 'seller' : /buyer/i.test(marketLine) ? 'buyer' : 'neutral'
      summary = lines.find((l) => /inventory|competition|balanced/i.test(l)) || null
    }

    // Extract page title for location context
    const titleEl = document.querySelector('h1')
    const location = titleEl ? titleEl.textContent?.trim() || '' : ''

    return {
      location,
      medianSalePrice: medianPrice,
      homesSold,
      medianDaysOnMarket,
      yoyChange: yoyDirection && yoyPercent ? { direction: yoyDirection, percent: yoyPercent } : null,
      saleToListPercent,
      competitiveness,
      neighborhood,
      marketType,
      summary,
    }
  })
}

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchHomes,
  getPropertyDetails,
  getMarketData,
}

const adapter: CodeAdapter = {
  name: 'redfin-dom',
  description: 'Redfin — home search, property details, market data via JSON-LD and DOM extraction',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('redfin.com')
  },

  async isAuthenticated(): Promise<boolean> {
    return true
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
