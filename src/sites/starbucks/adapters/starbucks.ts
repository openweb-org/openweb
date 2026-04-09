import type { Page } from 'patchright'

/**
 * Starbucks adapter — store finder and menu via BFF API proxy.
 *
 * Heavy bot detection (Cloudflare, Akamai, PerimeterX, DataDome) present
 * but managed browser session bypasses it. All APIs are GET requests via
 * pageFetch with explicit method: 'GET' (pageFetch defaults to POST).
 */

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
}

type Helpers = {
  pageFetch: (page: Page, opts: { url: string; method?: string; body?: string; headers?: Record<string, string>; timeout?: number }) => Promise<{ status: number; text: string }>
  errors: Errors
}

const BASE = 'https://www.starbucks.com'

async function searchStores(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const { errors } = helpers
  const lat = Number(params.lat)
  const lng = Number(params.lng)
  if (!lat || !lng) throw errors.missingParam('lat and lng')

  const resp = await helpers.pageFetch(page, {
    url: `${BASE}/apiproxy/v1/locations?lat=${lat}&lng=${lng}`,
    method: 'GET',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  })

  if (resp.status !== 200) throw errors.retriable(`Store API returned ${resp.status}`)
  const data = JSON.parse(resp.text) as Array<Record<string, unknown>>

  return {
    count: data.length,
    stores: data.map(mapStore).filter(Boolean),
  }
}

async function getStoreDetail(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const { errors } = helpers
  const storeNumber = String(params.storeNumber || '')
  if (!storeNumber) throw errors.missingParam('storeNumber')

  const lat = Number(params.lat)
  const lng = Number(params.lng)
  if (!lat || !lng) throw errors.missingParam('lat and lng (approximate store location)')

  const resp = await helpers.pageFetch(page, {
    url: `${BASE}/apiproxy/v1/locations?lat=${lat}&lng=${lng}`,
    method: 'GET',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  })

  if (resp.status !== 200) throw errors.retriable(`Store API returned ${resp.status}`)
  const data = JSON.parse(resp.text) as Array<Record<string, unknown>>

  const entry = data.find(e => {
    const s = e.store as Record<string, unknown> | undefined
    return s?.storeNumber === storeNumber
  })
  if (!entry) throw errors.fatal(`Store ${storeNumber} not found near lat=${lat}, lng=${lng}`)

  const store = entry.store as Record<string, unknown>
  const addr = store.address as Record<string, unknown> | undefined
  const coords = store.coordinates as Record<string, unknown> | undefined
  const schedule = (store.schedule as Array<Record<string, unknown>>) || []

  return {
    storeNumber: store.storeNumber,
    name: store.name,
    phoneNumber: store.phoneNumber,
    open: store.open,
    isOpen24Hours: store.isOpen24Hours,
    openStatus: store.openStatusFormatted,
    hours: store.hoursStatusFormatted,
    address: {
      streetAddress: (addr?.lines as string[] | undefined)?.[0],
      city: addr?.city,
      state: addr?.countrySubdivisionCode,
      postalCode: addr?.postalCode,
      country: addr?.countryCode,
      singleLine: addr?.singleLine,
    },
    coordinates: {
      latitude: (coords as Record<string, number> | undefined)?.latitude,
      longitude: (coords as Record<string, number> | undefined)?.longitude,
    },
    schedule: schedule.map(s => ({
      day: s.dayFormatted,
      hours: s.hoursFormatted,
      open: s.open,
    })),
    amenities: ((store.amenities as Array<Record<string, string>>) || []).map(a => ({
      code: a.code,
      name: a.name,
    })),
    mobileOrdering: {
      available: (store.mobileOrdering as Record<string, unknown>)?.availability === 'READY',
      guestOrdering: (store.mobileOrdering as Record<string, unknown>)?.guestOrdering,
    },
    ownershipType: store.ownershipTypeCode,
    slug: store.slug,
  }
}

async function getMenu(page: Page, _params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const resp = await helpers.pageFetch(page, {
    url: `${BASE}/apiproxy/v1/ordering/menu`,
    method: 'GET',
  })

  if (resp.status !== 200) throw helpers.errors.retriable(`Menu API returned ${resp.status}`)
  const data = JSON.parse(resp.text)
  const menus = (data.menus || []) as Array<Record<string, unknown>>

  return {
    categories: menus.map(cat => ({
      name: cat.name,
      subcategories: ((cat.children || []) as Array<Record<string, unknown>>).map(sub => ({
        name: sub.name,
        imageUrl: sub.categoryImageURL,
        products: ((sub.products || []) as Array<Record<string, unknown>>).map(p => ({
          name: p.name,
          productNumber: p.productNumber,
          productType: p.productType,
          availability: p.availability,
          imageUrl: p.imageURL,
          formCode: p.formCode,
          defaultSize: (p.defaultSize as Record<string, unknown>)?.displayName,
          sizes: ((p.sizes || []) as Array<Record<string, string>>).map(s => s.sizeCode),
        })),
      })),
    })),
  }
}

function mapStore(entry: Record<string, unknown>) {
  const store = entry.store as Record<string, unknown> | undefined
  if (!store) return null
  const addr = store.address as Record<string, unknown> | undefined
  const coords = store.coordinates as Record<string, unknown> | undefined
  return {
    storeNumber: store.storeNumber,
    name: store.name,
    distance: entry.distance,
    phoneNumber: store.phoneNumber,
    open: store.open,
    openStatus: store.openStatusFormatted,
    hours: store.hoursStatusFormatted,
    address: addr?.singleLine,
    city: addr?.city,
    state: addr?.countrySubdivisionCode,
    postalCode: addr?.postalCode,
    latitude: (coords as Record<string, number> | undefined)?.latitude,
    longitude: (coords as Record<string, number> | undefined)?.longitude,
    amenities: ((store.amenities as Array<Record<string, string>>) || []).map(a => a.name),
    mobileOrdering: (store.mobileOrdering as Record<string, unknown>)?.availability === 'READY',
  }
}

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, helpers: Helpers) => Promise<unknown>> = {
  searchStores,
  getStoreDetail,
  getMenu,
}

const adapter = {
  name: 'starbucks',
  description: 'Starbucks — store finder, store detail, and menu via BFF API proxy',

  async init(page: Page): Promise<boolean> {
    if (!page.url().includes('starbucks.com')) {
      try {
        await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 30_000 })
      } catch { return false }
    }
    return page.url().includes('starbucks.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>, helpers: Helpers): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page, { ...params }, helpers)
  },
}

export default adapter
