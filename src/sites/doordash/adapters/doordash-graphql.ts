/**
 * DoorDash L3 adapter — GraphQL API via browser fetch.
 *
 * DoorDash uses a GraphQL gateway at /graphql/<operationName>.
 * All requests are POST with JSON body { operationName, variables, query }.
 * Auth is via cookie_session (credentials: 'include' in browser fetch).
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
import type { Page } from 'playwright-core'

const GRAPHQL_URL = 'https://www.doordash.com/graphql'

/* ---------- simplified GraphQL queries ---------- */

const SEARCH_QUERY = `query autocompleteFacetFeed($query: String!) {
  autocompleteFacetFeed(query: $query) {
    body {
      id
      body {
        id
        name
        text { title subtitle accessory description }
        images { main { uri } }
        custom
        component { id category }
      }
    }
    page { next { name data } }
  }
}`

const STORE_MENU_QUERY = `query storepageFeed($storeId: ID!, $menuId: ID, $fulfillmentType: FulfillmentType) {
  storepageFeed(storeId: $storeId, menuId: $menuId, fulfillmentType: $fulfillmentType) {
    storeHeader {
      id name description priceRange priceRangeDisplayString
      offersDelivery offersPickup isDashpassPartner
      coverImgUrl coverSquareImgUrl
      address { lat lng city state street displayAddress }
      ratings { numRatings numRatingsDisplayString averageRating isNewlyAdded }
      status {
        delivery { isAvailable minutes displayUnavailableStatus }
        pickup { isAvailable minutes displayUnavailableStatus }
      }
      deliveryFeeLayout { title subtitle }
      businessTags { name link }
    }
    menuBook {
      id name displayOpenHours
      menuCategories { id name numItems }
    }
    itemLists {
      id name description
      items {
        id name description displayPrice imageUrl
        dietaryTagsList { type abbreviatedTagDisplayString }
        dynamicLabelDisplayString calloutDisplayString ratingDisplayString
      }
    }
    reviewPreview {
      consumerReviewData {
        avgRating numRatings numRatingsDisplayString numReviews
      }
    }
  }
}`

const ADD_CART_ITEM_MUTATION = `mutation addCartItem($addCartItemInput: AddCartItemInput!, $fulfillmentContext: FulfillmentContextInput!, $cartContext: CartContextInput, $returnCartFromOrderService: Boolean) {
  addCartItemV2(
    addCartItemInput: $addCartItemInput
    fulfillmentContext: $fulfillmentContext
    cartContext: $cartContext
    returnCartFromOrderService: $returnCartFromOrderService
  ) {
    id
    subtotal
    currencyCode
    fulfillmentType
    restaurant { id name slug }
    orders {
      id
      orderItems {
        id
        quantity
        singlePrice
        priceDisplayString
        item { id name imageUrl price }
      }
    }
  }
}`

const ORDER_HISTORY_QUERY = `query getConsumerOrdersWithDetails($offset: Int!, $limit: Int!, $includeCancelled: Boolean) {
  getConsumerOrdersWithDetails(offset: $offset, limit: $limit, includeCancelled: $includeCancelled) {
    id orderUuid createdAt submittedAt cancelledAt fulfilledAt
    isPickup fulfillmentType
    store { id name business { id name } }
    orders {
      id
      items { id name quantity originalItemPrice }
    }
    grandTotal { unitAmount currency decimalPlaces displayString }
    deliveryAddress { id formattedAddress }
  }
}`

/* ---------- adapter implementation ---------- */

async function graphqlFetch(
  page: Page,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const url = `${GRAPHQL_URL}/${operationName}?operation=${operationName}`
  const body = JSON.stringify({ operationName, variables, query })

  const result = await page.evaluate(
    async (args: { url: string; body: string }) => {
      const resp = await fetch(args.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: args.body,
        credentials: 'include',
      })
      return { status: resp.status, text: await resp.text() }
    },
    { url, body },
  )

  if (result.status >= 400) {
    throw OpenWebError.httpError(result.status)
  }

  const json = JSON.parse(result.text) as { data?: unknown; errors?: unknown[] }
  if (json.errors) {
    const msg = (json.errors[0] as Record<string, string>)?.message ?? 'Unknown GraphQL error'
    throw OpenWebError.apiError('DoorDash GraphQL', msg)
  }

  return json.data
}

/* ---------- operation handlers ---------- */

async function searchRestaurants(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')
  const data = (await graphqlFetch(page, 'autocompleteFacetFeed', SEARCH_QUERY, { query })) as Record<string, unknown>
  const feed = data.autocompleteFacetFeed as Record<string, unknown>

  // Extract restaurant cards from the nested facet structure
  const sections = (feed?.body ?? []) as Array<Record<string, unknown>>
  const restaurants: unknown[] = []

  for (const section of sections) {
    const items = (section.body ?? []) as Array<Record<string, unknown>>
    for (const item of items) {
      const text = item.text as Record<string, string> | undefined
      const images = item.images as Record<string, Record<string, string>> | undefined
      let storeId: string | undefined
      let resultType: string | undefined
      try {
        const custom = JSON.parse(item.custom as string)
        storeId = custom.store_id
        resultType = custom.result_type
      } catch { /* no custom data */ }

      restaurants.push({
        name: text?.title,
        categories: text?.description,
        imageUrl: images?.main?.uri,
        storeId,
        resultType,
      })
    }
  }

  return { restaurants, count: restaurants.length }
}

async function getRestaurantMenu(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const storeId = String(params.storeId ?? params.store_id)
  const menuId = params.menuId ?? params.menu_id
  const fulfillmentType = String(params.fulfillmentType ?? params.fulfillment_type ?? 'Delivery')

  const variables: Record<string, unknown> = { storeId, fulfillmentType }
  if (menuId) variables.menuId = String(menuId)

  const data = (await graphqlFetch(page, 'storepageFeed', STORE_MENU_QUERY, variables)) as Record<string, unknown>
  return data.storepageFeed
}

async function getOrderHistory(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const offset = Number(params.offset ?? 0)
  const limit = Number(params.limit ?? 10)
  const includeCancelled = params.includeCancelled !== false

  const data = (await graphqlFetch(
    page,
    'getConsumerOrdersWithDetails',
    ORDER_HISTORY_QUERY,
    { offset, limit, includeCancelled },
  )) as Record<string, unknown>

  return { orders: data.getConsumerOrdersWithDetails }
}

async function addToCart(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const storeId = String(params.storeId ?? params.store_id ?? '')
  const itemId = String(params.itemId ?? params.item_id ?? '')
  if (!storeId) throw OpenWebError.missingParam('storeId')
  if (!itemId) throw OpenWebError.missingParam('itemId')

  const quantity = Number(params.quantity ?? 1)
  const specialInstructions = String(params.specialInstructions ?? '')

  const variables = {
    addCartItemInput: {
      storeId,
      itemId,
      quantity,
      specialInstructions,
      substitutionPreference: 'substitute',
      cartId: '',
      isBundle: false,
      bundleType: 'BUNDLE_TYPE_UNSPECIFIED',
    },
    fulfillmentContext: {
      shouldUpdateFulfillment: false,
      fulfillmentType: 'Delivery',
    },
    cartContext: { isBundle: false },
    returnCartFromOrderService: false,
  }

  const data = (await graphqlFetch(page, 'addCartItem', ADD_CART_ITEM_MUTATION, variables)) as Record<string, unknown>
  const cart = data.addCartItemV2 as Record<string, unknown> | undefined

  // Extract cart items from response
  const orders = (cart?.orders ?? []) as Array<Record<string, unknown>>
  const items: unknown[] = []
  for (const order of orders) {
    for (const oi of (order.orderItems ?? []) as Array<Record<string, unknown>>) {
      const item = oi.item as Record<string, unknown> | undefined
      items.push({
        id: item?.id,
        name: item?.name,
        quantity: oi.quantity,
        price: oi.priceDisplayString,
      })
    }
  }

  const restaurant = cart?.restaurant as Record<string, string> | undefined

  return {
    success: !!cart?.id,
    cartId: cart?.id,
    subtotal: cart?.subtotal,
    currencyCode: cart?.currencyCode,
    restaurant: restaurant ? { id: restaurant.id, name: restaurant.name } : undefined,
    items,
  }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchRestaurants,
  getRestaurantMenu,
  getOrderHistory,
  addToCart,
}

const adapter: CodeAdapter = {
  name: 'doordash-graphql',
  description: 'DoorDash GraphQL API — restaurant search, menus, order history, cart',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('doordash.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://www.doordash.com')
    return cookies.some((c) => c.name === 'dd_session_id' || c.name === 'ddweb_token')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) {
        throw OpenWebError.unknownOp(operation)
      }
      return handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
