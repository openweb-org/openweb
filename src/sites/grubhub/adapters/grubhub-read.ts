import type { CustomRunner, AdapterHelpers } from '../../../types/adapter.js'

type Params = Readonly<Record<string, unknown>>
type Ctx = { page: NonNullable<import('patchright').Page>; helpers: AdapterHelpers }

const API = 'https://api-gtm.grubhub.com'

async function searchRestaurants(ctx: Ctx, params: Params): Promise<unknown> {
  const lat = Number(params.latitude)
  const lng = Number(params.longitude)
  if (!lat || !lng) throw ctx.helpers.errors.missingParam('latitude and longitude')

  const searchTerm = params.searchTerm
    ? `&searchTerm=${encodeURIComponent(String(params.searchTerm))}`
    : ''
  const pageSize = Number(params.pageSize) || 20
  const pageNum = Math.max(1, Number(params.pageNum) || 1)

  const url = `${API}/restaurants/search/search_listing?orderMethod=delivery&locationMode=DELIVERY&pageSize=${pageSize}&pageNum=${pageNum}&latitude=${lat}&longitude=${lng}${searchTerm}`
  const resp = await ctx.helpers.pageFetch(ctx.page, { url, method: 'GET' })
  if (resp.status !== 200) throw ctx.helpers.errors.httpError(resp.status)

  const data = JSON.parse(resp.text) as Record<string, unknown>
  const results = (data.results as Array<Record<string, unknown>>) ?? []
  const stats = data.stats as Record<string, unknown> | undefined

  return {
    totalResults: stats?.total_results ?? results.length,
    restaurants: results.map((r) => {
      const ratings = r.ratings as Record<string, unknown> | undefined
      const addr = r.address as Record<string, unknown> | undefined
      const deliveryFee = r.delivery_fee as Record<string, unknown> | undefined
      const estRange = r.delivery_estimate_range as Record<string, unknown> | undefined
      return {
        restaurantId: String(r.restaurant_id),
        name: r.name,
        logo: r.logo ?? null,
        cuisines: r.cuisines ?? [],
        rating: ratings?.rating_bayesian10_point ?? null,
        ratingCount: ratings?.rating_count ?? 0,
        priceRating: r.price_rating ?? 0,
        deliveryFee: deliveryFee ? (deliveryFee.price as number) / 100 : 0,
        deliveryEstimateMin: (estRange?.start_time_minutes ?? r.delivery_time_estimate_lower_bound) ?? null,
        deliveryEstimateMax: (estRange?.end_time_minutes ?? r.delivery_time_estimate_upper_bound) ?? null,
        address: addr?.street_address ?? null,
        distance: r.distance_from_location ? Number(r.distance_from_location) : null,
      }
    }),
  }
}

async function getMenu(ctx: Ctx, params: Params): Promise<unknown> {
  const restaurantId = String(params.restaurantId || '')
  if (!restaurantId) throw ctx.helpers.errors.missingParam('restaurantId')

  const url = `${API}/restaurants/${restaurantId}?hideChoiceCategories=true&orderType=standard&version=4&variationId=default&hideUnavailableMenuItems=true&hideMenuItems=false&showMenuItemCoupons=true&includeOffers=true&locationMode=DELIVERY`
  const resp = await ctx.helpers.pageFetch(ctx.page, { url, method: 'GET' })
  if (resp.status !== 200) throw ctx.helpers.errors.httpError(resp.status)

  const data = JSON.parse(resp.text) as Record<string, unknown>
  const rest = data.restaurant as Record<string, unknown> | undefined
  if (!rest) throw ctx.helpers.errors.fatal(`Restaurant ${restaurantId} not found`)

  const categories = (rest.menu_category_list as Array<Record<string, unknown>>) ?? []
  return {
    restaurantName: rest.name,
    categories: categories.map((cat) => ({
      name: cat.name,
      items: ((cat.menu_item_list as Array<Record<string, unknown>>) ?? []).map((item) => {
        const price = item.price as Record<string, unknown> | undefined
        return {
          itemId: String(item.id),
          name: item.name,
          description: item.description || null,
          price: price ? (price.amount as number) / 100 : 0,
          popular: item.popular === true,
        }
      }),
    })),
  }
}

async function getDeliveryEstimate(ctx: Ctx, params: Params): Promise<unknown> {
  const restaurantId = String(params.restaurantId || '')
  if (!restaurantId) throw ctx.helpers.errors.missingParam('restaurantId')

  const url = `${API}/restaurants/${restaurantId}?hideChoiceCategories=true&orderType=standard&version=4&variationId=default&hideUnavailableMenuItems=true&hideMenuItems=true&locationMode=DELIVERY`
  const resp = await ctx.helpers.pageFetch(ctx.page, { url, method: 'GET' })
  if (resp.status !== 200) throw ctx.helpers.errors.httpError(resp.status)

  const data = JSON.parse(resp.text) as Record<string, unknown>
  const avail = data.restaurant_availability as Record<string, unknown> | undefined
  if (!avail) throw ctx.helpers.errors.fatal(`Restaurant ${restaurantId} availability not found`)

  const deliveryFee = avail.delivery_fee as Record<string, unknown> | undefined
  const orderMin = avail.order_minimum as Record<string, unknown> | undefined
  const deliveryRange = avail.delivery_estimate_range_v2 as Record<string, unknown> | undefined
  const pickupRange = avail.pickup_estimate_range_v2 as Record<string, unknown> | undefined

  return {
    restaurantId,
    open: avail.open ?? false,
    openDelivery: avail.open_delivery ?? false,
    openPickup: avail.open_pickup ?? false,
    deliveryEstimateMin: deliveryRange?.minimum ?? avail.delivery_estimate ?? 0,
    deliveryEstimateMax: deliveryRange?.maximum ?? avail.delivery_estimate ?? 0,
    pickupEstimateMin: pickupRange?.minimum ?? null,
    pickupEstimateMax: pickupRange?.maximum ?? null,
    deliveryFee: deliveryFee ? (deliveryFee.amount as number) / 100 : 0,
    orderMinimum: orderMin ? (orderMin.amount as number) / 100 : 0,
    salesTax: avail.sales_tax ?? 0,
  }
}

const adapter: CustomRunner = {
  name: 'grubhub-read',
  description: 'Grubhub — restaurant search, menus, and delivery estimates with response trimming',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    if (!page) throw helpers.errors.fatal('grubhub-read adapter requires a browser page')

    switch (operation) {
      case 'searchRestaurants':
        return searchRestaurants({ page, helpers }, params)
      case 'getMenu':
        return getMenu({ page, helpers }, params)
      case 'getDeliveryEstimate':
        return getDeliveryEstimate({ page, helpers }, params)
      default:
        throw helpers.errors.unknownOp(operation)
    }
  },
}

export default adapter
