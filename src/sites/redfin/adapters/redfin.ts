import type { Page } from 'patchright'

import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner } from '../../../types/adapter.js'

type AdapterErrors = { botBlocked(msg: string): Error; unknownOp(op: string): Error; wrap(error: unknown): Error }

const BASE = 'https://www.redfin.com'

/** Strip Redfin JSONP protection prefix `{}&&` and parse JSON. */
function parseStingray(text: string): { resultCode: number; errorMessage: string; payload: any } {
  return JSON.parse(text.replace(/^\{\}&&/, ''))
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  frac12: '½', frac14: '¼', frac34: '¾', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name) => ENTITY_MAP[name.toLowerCase()] ?? m)
}

function trimText(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

/** Property type enum → human-readable string. */
const PROPERTY_TYPES: Record<number, string> = {
  1: 'Single Family Residential', 2: 'Condo/Co-op', 3: 'Townhouse',
  4: 'Multi-Family', 5: 'Land', 6: 'Single Family Residential',
  7: 'Mobile/Manufactured', 8: 'Farm/Ranch',
}

// ── searchHomes: Stingray GIS API ────────────────────

async function searchHomes(
  _page: Page | null, params: Record<string, unknown>, errors: AdapterErrors,
): Promise<unknown> {
  const { regionId, state, city } = params as { regionId: string; state: string; city: string }
  const market = city.toLowerCase().replace(/\s+/g, '-')
  const qs = new URLSearchParams({
    al: '1', market, num_homes: '15', ord: 'redfin-recommended-asc',
    page_number: '1', region_id: regionId, region_type: '6',
    sf: '1,2,3,5,6,7', status: '9', uipt: '1,2,3,4,5,6,7,8', v: '8',
  })
  const result = await nodeFetch({ url: `${BASE}/stingray/api/gis?${qs}` })
  if (result.status !== 200) throw errors.botBlocked(`Stingray GIS returned ${result.status}`)

  const data = parseStingray(result.text)
  if (data.resultCode !== 0) throw errors.wrap(new Error(`GIS error: ${data.errorMessage}`))

  const homes: any[] = data.payload.homes || []
  const listings = homes.map((h: any) => ({
    url: h.url ? `${BASE}${h.url}` : '',
    streetAddress: h.streetLine?.value || '',
    zip: h.zip || h.postalCode?.value || '',
    rooms: h.beds ?? null,
    sqft: h.sqFt?.value ?? null,
    price: h.price?.value ?? null,
    propertyType: PROPERTY_TYPES[h.uiPropertyType] || PROPERTY_TYPES[h.propertyType] || '',
  }))

  return { resultCount: listings.length, listings }
}

// ── getPropertyDetails: fetch HTML → parse JSON-LD ───

async function getPropertyDetails(
  _page: Page | null, params: Record<string, unknown>, errors: AdapterErrors,
): Promise<unknown> {
  const { state, city, address, propertyId } = params as {
    state: string; city: string; address: string; propertyId: string
  }
  const path = `/${state}/${city}/${address}/home/${propertyId}`
  const result = await nodeFetch({
    url: `${BASE}${path}`,
    headers: { Accept: 'text/html' },
  })

  if (result.status !== 200) throw errors.botBlocked(`Property page returned ${result.status}`)

  // Parse JSON-LD blocks from raw HTML
  const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  let match: RegExpExecArray | null
  for (match = jsonLdRegex.exec(result.text); match !== null; match = jsonLdRegex.exec(result.text)) {
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
        description: trimText(decodeEntities(data.description || ''), 400),
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
        availability: typeof offer.availability === 'string'
          ? offer.availability.replace(/^https?:\/\/schema\.org\//, '')
          : '',
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
    url: `${BASE}${path}`,
    datePosted: '', streetAddress: '', city: '', state: '', zip: '',
    latitude: null, longitude: null, bedrooms: null, bathrooms: null,
    sqft: null, yearBuilt: null, propertyType: '', price: null,
    currency: 'USD', availability: '', amenities: [], imageCount: 0, primaryImage: '',
  }
}

// ── getMarketData: fetch HTML → regex text extraction ─

async function getMarketData(
  _page: Page | null, params: Record<string, unknown>, errors: AdapterErrors,
): Promise<unknown> {
  const { regionId, state, city } = params as { regionId: string; state: string; city: string }
  const result = await nodeFetch({
    url: `${BASE}/city/${regionId}/${state}/${city}/housing-market`,
    headers: { Accept: 'text/html' },
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

  return {
    location,
    medianSalePrice: medianMatch ? `$${medianMatch[1]}` : null,
    homesSold: homeSoldMatch ? Number(homeSoldMatch[1].replace(/,/g, '')) : null,
    medianDaysOnMarket: medianDomMatch ? Number(medianDomMatch[1]) : null,
    yoyChange: yoyMatch ? { direction: yoyMatch[1].toLowerCase(), percent: Number(yoyMatch[2]) } : null,
    saleToListPercent: saleToListMatch ? Number(saleToListMatch[1]) : null,
    competitiveness: competitiveMatch ? competitiveMatch[1] : null,
  }
}

// ── Adapter export ───────────────────────────────────

const OPERATIONS: Record<string, (page: Page | null, params: Record<string, unknown>, errors: AdapterErrors) => Promise<unknown>> = {
  searchHomes,
  getPropertyDetails,
  getMarketData,
}

const adapter: CustomRunner = {
  name: 'redfin',
  description: 'Redfin — node-native Stingray API + HTML fetch. No browser needed.',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const { errors } = helpers as { errors: AdapterErrors }
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    try {
      return await handler(page as Page | null, { ...params }, errors)
    } catch (error) {
      throw errors.wrap(error)
    }
  },
}

export default adapter
