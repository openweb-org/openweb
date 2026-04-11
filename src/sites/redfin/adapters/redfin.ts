import type { Page } from 'patchright'

type PageFetch = (page: Page, options: { url: string; method?: 'GET' | 'POST'; headers?: Record<string, string>; credentials?: 'same-origin' | 'include'; timeout?: number }) => Promise<{ status: number; text: string }>
type AdapterErrors = { botBlocked(msg: string): Error; unknownOp(op: string): Error; wrap(error: unknown): Error }

/** Strip Redfin JSONP protection prefix `{}&&` and parse JSON. */
function parseStingray(text: string): { resultCode: number; errorMessage: string; payload: any } {
  return JSON.parse(text.replace(/^\{\}&&/, ''))
}

/** Property type enum → human-readable string. */
const PROPERTY_TYPES: Record<number, string> = {
  1: 'Single Family Residential', 2: 'Condo/Co-op', 3: 'Townhouse',
  4: 'Multi-Family', 5: 'Land', 6: 'Single Family Residential',
  7: 'Mobile/Manufactured', 8: 'Farm/Ranch',
}

// ── searchHomes: Stingray GIS API ────────────────────

async function searchHomes(
  page: Page, params: Record<string, unknown>,
  pageFetch: PageFetch, errors: AdapterErrors,
): Promise<unknown> {
  const { regionId, state, city } = params as { regionId: string; state: string; city: string }
  const market = city.toLowerCase().replace(/\s+/g, '-')
  const qs = new URLSearchParams({
    al: '1', market, num_homes: '20', ord: 'redfin-recommended-asc',
    page_number: '1', region_id: regionId, region_type: '6',
    sf: '1,2,3,5,6,7', status: '9', uipt: '1,2,3,4,5,6,7,8', v: '8',
  })
  const result = await pageFetch(page, {
    url: `/stingray/api/gis?${qs}`, method: 'GET', credentials: 'same-origin',
  })
  if (result.status !== 200) throw errors.botBlocked(`Stingray GIS returned ${result.status}`)

  const data = parseStingray(result.text)
  if (data.resultCode !== 0) throw errors.wrap(new Error(`GIS error: ${data.errorMessage}`))

  const homes: any[] = data.payload.homes || []
  const listings = homes.map((h: any) => ({
    name: h.streetLine?.value || '',
    url: h.url || '',
    streetAddress: h.streetLine?.value || '',
    city: h.city || '',
    state: h.state || '',
    zip: h.zip || h.postalCode?.value || '',
    latitude: h.latLong?.value?.latitude ?? null,
    longitude: h.latLong?.value?.longitude ?? null,
    rooms: h.beds ?? null,
    sqft: h.sqFt?.value ?? null,
    price: h.price?.value ?? null,
    currency: 'USD',
    propertyType: PROPERTY_TYPES[h.uiPropertyType] || PROPERTY_TYPES[h.propertyType] || '',
  }))

  return { resultCount: listings.length, description: `${listings.length} homes for sale in ${city}, ${state}`, listings }
}

// ── getPropertyDetails: fetch HTML → parse JSON-LD ───

async function getPropertyDetails(
  page: Page, params: Record<string, unknown>,
  pageFetch: PageFetch, errors: AdapterErrors,
): Promise<unknown> {
  const { state, city, address, propertyId } = params as {
    state: string; city: string; address: string; propertyId: string
  }
  const path = `/${state}/${city}/${address}/home/${propertyId}`
  const result = await pageFetch(page, {
    url: `https://www.redfin.com${path}`, method: 'GET',
    headers: { Accept: 'text/html' }, credentials: 'same-origin',
  })

  if (result.status !== 200) throw errors.botBlocked(`Property page returned ${result.status}`)

  // Parse JSON-LD blocks from raw HTML
  const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  let match: RegExpExecArray | null
  while ((match = jsonLdRegex.exec(result.text)) !== null) {
    try {
      const data = JSON.parse(match[1])
      if (!data['@type'] || !Array.isArray(data['@type'])) continue
      if (!data['@type'].includes('RealEstateListing')) continue

      const entity = data.mainEntity || {}
      const addr = entity.address || {}
      const geo = entity.geo || {}
      const floor = entity.floorSize || {}
      const offer = data.offers || {}
      const amenities = (entity.amenityFeature || []).map((a: any) => a.name || '')
      const images = Array.isArray(entity.image)
        ? entity.image.map((img: any) => typeof img === 'string' ? img : img.url || '')
        : data.image ? [typeof data.image === 'string' ? data.image : data.image.url || ''] : []

      return {
        name: data.name || '',
        description: (data.description || '').replace(/&[a-z]+;/g, ' ').trim(),
        url: data.url || '',
        datePosted: data.datePosted || '',
        streetAddress: addr.streetAddress || '',
        city: addr.addressLocality || '',
        state: addr.addressRegion || '',
        zip: addr.postalCode || '',
        latitude: geo.latitude ?? null,
        longitude: geo.longitude ?? null,
        bedrooms: entity.numberOfBedrooms ?? null,
        bathrooms: entity.numberOfBathroomsTotal ?? null,
        sqft: floor.value ?? null,
        yearBuilt: entity.yearBuilt ?? null,
        propertyType: entity.accommodationCategory || entity['@type'] || '',
        price: Number(offer.price) || null,
        currency: offer.priceCurrency || 'USD',
        availability: offer.availability || '',
        amenities,
        imageCount: images.length,
        primaryImage: images[0] || '',
      }
    } catch { /* skip malformed JSON-LD */ }
  }

  // Fallback: extract from <title> and <meta>
  const titleMatch = result.text.match(/<title[^>]*>(.*?)<\/title>/i)
  const metaMatch = result.text.match(/<meta\s+name="description"\s+content="([^"]*)"/i)
  return {
    name: (titleMatch?.[1] || '').replace(/ \| Redfin$/, ''),
    description: metaMatch?.[1] || '',
    url: `https://www.redfin.com${path}`,
    datePosted: '', streetAddress: '', city: '', state: '', zip: '',
    latitude: null, longitude: null, bedrooms: null, bathrooms: null,
    sqft: null, yearBuilt: null, propertyType: '', price: null,
    currency: 'USD', availability: '', amenities: [], imageCount: 0, primaryImage: '',
  }
}

// ── getMarketData: fetch HTML → regex text extraction ─

async function getMarketData(
  page: Page, params: Record<string, unknown>,
  pageFetch: PageFetch, errors: AdapterErrors,
): Promise<unknown> {
  const { regionId, state, city } = params as { regionId: string; state: string; city: string }
  const result = await pageFetch(page, {
    url: `https://www.redfin.com/city/${regionId}/${state}/${city}/housing-market`,
    method: 'GET', headers: { Accept: 'text/html' }, credentials: 'same-origin',
  })

  if (result.status !== 200) throw errors.botBlocked(`Market page returned ${result.status}`)

  const html = result.text
  // Strip scripts/styles, then tags → plain text
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')

  const medianMatch = text.match(/median sale price.*?\$([\d,]+(?:K)?)/i)
  const homeSoldMatch = text.match(/([\d,]+)\s*(?:homes?\s*)?(?:were\s+)?sold/i)
  const medianDomMatch = text.match(/median days on (?:the )?market.*?(\d+)/i)
  const yoyMatch = text.match(/(up|down)\s+([\d.]+)%\s+since last year/i)
  const saleToListMatch = text.match(/sale-to-list.*?([\d.]+)%/i)
  const competitiveMatch = text.match(/(very competitive|competitive|somewhat competitive|not very competitive)/i)

  // Extract location from <h1>
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const location = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : ''

  // Market insights from data attribute section
  const insightsMatch = html.match(/data-rf-test-id="market-insights-expandable-preview"[^>]*>([\s\S]*?)<\/div>/i)
  let neighborhood: string | null = null
  let marketType: string | null = null
  let summary: string | null = null

  if (insightsMatch) {
    const sectionText = insightsMatch[1].replace(/<[^>]+>/g, '\n').trim()
    const lines = sectionText.split('\n').map(l => l.trim()).filter(Boolean)
    const marketLine = lines.find(l => /is a (seller|buyer)/i.test(l)) || ''
    const neighborhoodMatch = marketLine.match(/^(.+?) is a/i)
    neighborhood = neighborhoodMatch ? neighborhoodMatch[1] : null
    marketType = /seller/i.test(marketLine) ? 'seller' : /buyer/i.test(marketLine) ? 'buyer' : 'neutral'
    summary = lines.find(l => /inventory|competition|balanced/i.test(l)) || null
  }

  return {
    location,
    medianSalePrice: medianMatch ? `$${medianMatch[1]}` : null,
    homesSold: homeSoldMatch ? Number(homeSoldMatch[1].replace(/,/g, '')) : null,
    medianDaysOnMarket: medianDomMatch ? Number(medianDomMatch[1]) : null,
    yoyChange: yoyMatch ? { direction: yoyMatch[1].toLowerCase(), percent: Number(yoyMatch[2]) } : null,
    saleToListPercent: saleToListMatch ? Number(saleToListMatch[1]) : null,
    competitiveness: competitiveMatch ? competitiveMatch[1] : null,
    neighborhood,
    marketType,
    summary,
  }
}

// ── Adapter export ───────────────────────────────────

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, pageFetch: PageFetch, errors: AdapterErrors) => Promise<unknown>> = {
  searchHomes,
  getPropertyDetails,
  getMarketData,
}

const adapter = {
  name: 'redfin',
  description: 'Redfin — Stingray API + HTML fetch. Zero DOM operations.',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('redfin.com')
  },

  async isAuthenticated(): Promise<boolean> {
    return true
  },

  async execute(
    page: Page, operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { pageFetch, errors } = helpers as { pageFetch: PageFetch; errors: AdapterErrors }
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page, { ...params }, pageFetch, errors)
  },
}

export default adapter
