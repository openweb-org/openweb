import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
  httpError(status: number): Error
  wrap(error: unknown): Error
}

type Helpers = {
  pageFetch: (page: Page, opts: { url: string; method?: string; body?: string; headers?: Record<string, string>; timeout?: number }) => Promise<{ status: number; text: string }>
  errors: Errors
}

const BASE = 'https://www.starbucks.com'

function trimStore(store: Record<string, unknown>): Record<string, unknown> {
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
  if (resp.status !== 200) throw errors.httpError(resp.status)
  const data = JSON.parse(resp.text) as Array<Record<string, unknown>>

  return data.map(entry => ({
    distance: entry.distance,
    store: trimStore(entry.store as Record<string, unknown>),
  }))
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

  return trimStore(entry.store as Record<string, unknown>)
}

function trimProduct(p: Record<string, unknown>): Record<string, unknown> {
  return {
    name: p.name,
    productType: p.productType,
    availability: p.availability,
    imageURL: p.imageURL,
    sizes: ((p.sizes as Array<Record<string, unknown>>) ?? []).map(s => s.sizeCode),
  }
}

function trimCategory(cat: Record<string, unknown>): Record<string, unknown> {
  const products = (cat.products as Array<Record<string, unknown>>) ?? []
  const children = (cat.children as Array<Record<string, unknown>>) ?? []
  return {
    name: cat.name,
    ...(cat.categoryImageURL ? { imageURL: cat.categoryImageURL } : {}),
    ...(products.length > 0 ? { products: products.map(trimProduct) } : {}),
    ...(children.length > 0 ? { children: children.map(trimCategory) } : {}),
  }
}

async function getMenu(page: Page, _params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const resp = await helpers.pageFetch(page, {
    url: `${BASE}/apiproxy/v1/ordering/menu`,
    method: 'GET',
  })
  if (resp.status !== 200) throw helpers.errors.httpError(resp.status)
  const body = JSON.parse(resp.text) as Record<string, unknown>

  const menus = (body.menus as Array<Record<string, unknown>>) ?? []
  return { menus: menus.map(trimCategory) }
}

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, helpers: Helpers) => Promise<unknown>> = {
  searchStores,
  getStoreDetail,
  getMenu,
}

const adapter: CustomRunner = {
  name: 'starbucks',
  description: 'Starbucks — store search, detail, and menu with response trimming',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const h = helpers as unknown as Helpers
    const handler = OPERATIONS[operation]
    if (!handler) throw h.errors.unknownOp(operation)
    try {
      return await handler(page as Page, { ...params }, h)
    } catch (error) {
      throw h.errors.wrap(error)
    }
  },
}

export default adapter
