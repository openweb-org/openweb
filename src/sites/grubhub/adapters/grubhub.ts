import type { Page } from 'patchright'

/**
 * Grubhub adapter — restaurant search, menu, and delivery estimates via internal API.
 *
 * API lives at api-gtm.grubhub.com. Heavy bot detection (Cloudflare, PerimeterX,
 * DataDome) requires page transport. All ops work via page.evaluate(fetch) with
 * credentials: 'include'.
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

const API = 'https://api-gtm.grubhub.com'

async function searchRestaurants(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const { errors } = helpers
  const lat = Number(params.latitude)
  const lng = Number(params.longitude)
  if (!lat || !lng) throw errors.missingParam('latitude and longitude')

  const searchTerm = params.searchTerm ? `&searchTerm=${encodeURIComponent(String(params.searchTerm))}` : ''
  const pageSize = Number(params.pageSize) || 20
  const pageNum = Math.max(1, Number(params.pageNum) || 1)

  const url = `${API}/restaurants/search/search_listing?orderMethod=delivery&locationMode=DELIVERY&pageSize=${pageSize}&pageNum=${pageNum}&latitude=${lat}&longitude=${lng}${searchTerm}`
  const resp = await helpers.pageFetch(page, { url, method: 'GET' })

  if (resp.status !== 200) throw errors.retriable(`Search API returned ${resp.status}`)
  const data = JSON.parse(resp.text) as Record<string, unknown>

  const results = (data.results || []) as Array<Record<string, unknown>>
  const stats = data.stats as Record<string, number> | undefined

  return {
    totalResults: stats?.total_results ?? results.length,
    restaurants: results.map(r => {
      const ratings = r.ratings as Record<string, unknown> | undefined
      const addr = r.address as Record<string, unknown> | undefined
      const deliveryFee = r.delivery_fee as Record<string, number> | undefined
      const estRange = r.delivery_estimate_range as Record<string, unknown> | undefined

      return {
        restaurantId: String(r.restaurant_id),
        name: r.name,
        logo: r.logo ?? null,
        cuisines: r.cuisines ?? [],
        rating: ratings?.rating_bayesian10_point ?? null,
        ratingCount: ratings?.rating_count ?? 0,
        priceRating: r.price_rating ?? 0,
        deliveryFee: deliveryFee ? deliveryFee.price / 100 : 0,
        deliveryEstimateMin: (estRange?.start_time_minutes as number) ?? r.delivery_time_estimate_lower_bound ?? null,
        deliveryEstimateMax: (estRange?.end_time_minutes as number) ?? r.delivery_time_estimate_upper_bound ?? null,
        address: addr?.street_address ?? null,
        distance: r.distance_from_location ? Number(r.distance_from_location) : null,
      }
    }),
  }
}

async function getMenu(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const { errors } = helpers
  const restaurantId = String(params.restaurantId || '')
  if (!restaurantId) throw errors.missingParam('restaurantId')

  const url = `${API}/restaurants/${restaurantId}?hideChoiceCategories=true&orderType=standard&version=4&variationId=default&hideUnavailableMenuItems=true&hideMenuItems=false&showMenuItemCoupons=true&includeOffers=true&locationMode=DELIVERY`
  const resp = await helpers.pageFetch(page, { url, method: 'GET' })

  if (resp.status !== 200) throw errors.retriable(`Restaurant API returned ${resp.status}`)
  const data = JSON.parse(resp.text) as Record<string, unknown>
  const rest = data.restaurant as Record<string, unknown>
  if (!rest) throw errors.fatal(`Restaurant ${restaurantId} not found`)

  const categories = (rest.menu_category_list || []) as Array<Record<string, unknown>>

  return {
    restaurantName: rest.name,
    categories: categories.map(cat => ({
      name: cat.name,
      items: ((cat.menu_item_list || []) as Array<Record<string, unknown>>).map(item => {
        const price = item.price as Record<string, number> | undefined
        return {
          itemId: String(item.id),
          name: item.name,
          description: item.description || null,
          price: price ? price.amount / 100 : 0,
          popular: item.popular === true,
        }
      }),
    })),
  }
}

async function getDeliveryEstimate(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const { errors } = helpers
  const restaurantId = String(params.restaurantId || '')
  if (!restaurantId) throw errors.missingParam('restaurantId')

  const url = `${API}/restaurants/${restaurantId}?hideChoiceCategories=true&orderType=standard&version=4&variationId=default&hideUnavailableMenuItems=true&hideMenuItems=true&locationMode=DELIVERY`
  const resp = await helpers.pageFetch(page, { url, method: 'GET' })

  if (resp.status !== 200) throw errors.retriable(`Restaurant API returned ${resp.status}`)
  const data = JSON.parse(resp.text) as Record<string, unknown>
  const avail = data.restaurant_availability as Record<string, unknown>
  if (!avail) throw errors.fatal(`Restaurant ${restaurantId} availability not found`)

  const deliveryFee = avail.delivery_fee as Record<string, number> | undefined
  const orderMin = avail.order_minimum as Record<string, number> | undefined
  const deliveryRange = avail.delivery_estimate_range_v2 as Record<string, number> | undefined
  const pickupRange = avail.pickup_estimate_range_v2 as Record<string, number> | undefined

  return {
    restaurantId,
    open: avail.open ?? false,
    openDelivery: avail.open_delivery ?? false,
    openPickup: avail.open_pickup ?? false,
    deliveryEstimateMin: deliveryRange?.minimum ?? avail.delivery_estimate ?? 0,
    deliveryEstimateMax: deliveryRange?.maximum ?? avail.delivery_estimate ?? 0,
    pickupEstimateMin: pickupRange?.minimum ?? null,
    pickupEstimateMax: pickupRange?.maximum ?? null,
    deliveryFee: deliveryFee ? deliveryFee.amount / 100 : 0,
    orderMinimum: orderMin ? orderMin.amount / 100 : 0,
    salesTax: avail.sales_tax ?? 0,
  }
}

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, helpers: Helpers) => Promise<unknown>> = {
  searchRestaurants,
  getMenu,
  getDeliveryEstimate,
}

const BASE = 'https://www.grubhub.com'

const adapter = {
  name: 'grubhub',
  description: 'Grubhub — restaurant search, menus, and delivery estimates via internal API',

  async init(page: Page): Promise<boolean> {
    if (!page.url().includes('grubhub.com')) {
      try {
        await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 30_000 })
      } catch { return false }
    }
    return page.url().includes('grubhub.com')
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
