import type { CustomRunner, PreparedContext } from '../../../types/adapter.js'

type Params = Readonly<Record<string, unknown>>

const GQL_BASE = 'https://www.doordash.com/graphql'

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

const MENU_QUERY = `query storepageFeed($storeId: ID!, $menuId: ID, $fulfillmentType: FulfillmentType) {
  storepageFeed(storeId: $storeId, menuId: $menuId, fulfillmentType: $fulfillmentType) {
    storeHeader {
      id name description priceRange priceRangeDisplayString
      offersDelivery offersPickup isDashpassPartner
      coverSquareImgUrl
      address { city state street displayAddress }
      ratings { numRatingsDisplayString averageRating }
      status {
        delivery { isAvailable minutes displayUnavailableStatus }
        pickup { isAvailable minutes displayUnavailableStatus }
      }
      deliveryFeeLayout { title subtitle }
      businessTags { name }
    }
    menuBook {
      id name displayOpenHours
      menuCategories { id name numItems }
    }
    itemLists {
      id name
      items {
        id name description displayPrice imageUrl
        ratingDisplayString
      }
    }
  }
}`

async function searchRestaurants(ctx: PreparedContext): Promise<unknown> {
  const { page, helpers } = ctx
  if (!page) throw helpers.errors.fatal('doordash-read requires a browser page')

  const query = String(ctx.params.query ?? '')
  if (!query) throw helpers.errors.missingParam('query')

  const raw = await helpers.graphqlFetch(page, {
    url: `${GQL_BASE}/autocompleteFacetFeed?operation=autocompleteFacetFeed`,
    operationName: 'autocompleteFacetFeed',
    variables: { query },
    query: SEARCH_QUERY,
  }) as Record<string, unknown>

  const feed = raw.data as Record<string, unknown> | undefined
  const acf = (feed?.autocompleteFacetFeed ?? raw.autocompleteFacetFeed) as Record<string, unknown> | undefined
  if (!acf) return raw

  const bodyGroups = (acf.body as Array<Record<string, unknown>>) ?? []
  const results: Array<Record<string, unknown>> = []

  for (const group of bodyGroups) {
    const items = (group.body as Array<Record<string, unknown>>) ?? []
    for (const item of items) {
      const text = (item.text as Record<string, unknown>) ?? {}
      const images = item.images as Record<string, unknown> | null
      const mainImg = images?.main as Record<string, unknown> | null

      let storeId: string | null = null
      let resultType: string | null = null
      let rating: number | null = null
      let ratingCount: string | null = null

      const customStr = item.custom as string | null
      if (customStr) {
        try {
          const parsed = JSON.parse(customStr) as Record<string, unknown>
          storeId = (parsed.store_id as string) ?? null
          resultType = (parsed.result_type as string) ?? null
          const ratingObj = parsed.rating as Record<string, unknown> | undefined
          if (ratingObj) {
            rating = (ratingObj.average as number) ?? null
            ratingCount = (ratingObj.count_display_string as string) ?? null
          }
        } catch { /* non-JSON custom field — skip */ }
      }

      results.push({
        title: text.title ?? null,
        subtitle: text.subtitle ?? null,
        description: text.description ?? null,
        imageUrl: mainImg?.uri ?? null,
        storeId,
        resultType,
        rating,
        ratingCount,
      })
    }
  }

  return { results }
}

async function getRestaurantMenu(ctx: PreparedContext): Promise<unknown> {
  const { page, helpers } = ctx

  if (!page) throw helpers.errors.fatal('doordash-read requires a browser page')

  const storeId = String(ctx.params.storeId ?? '')
  if (!storeId) throw helpers.errors.missingParam('storeId')
  const menuId = ctx.params.menuId as string | undefined
  const fulfillmentType = (ctx.params.fulfillmentType as string) ?? 'Delivery'

  const raw = await helpers.graphqlFetch(page, {
    url: `${GQL_BASE}/storepageFeed?operation=storepageFeed`,
    operationName: 'storepageFeed',
    variables: { storeId, ...(menuId ? { menuId } : {}), fulfillmentType },
    query: MENU_QUERY,
  }) as Record<string, unknown>

  const feed = raw.data as Record<string, unknown> | undefined
  const sp = (feed?.storepageFeed ?? raw.storepageFeed) as Record<string, unknown> | undefined
  if (!sp) return raw

  const header = sp.storeHeader as Record<string, unknown> | undefined
  const menuBook = sp.menuBook as Record<string, unknown> | undefined
  const itemLists = (sp.itemLists as Array<Record<string, unknown>>) ?? []

  const trimmedItems = itemLists.map((list) => {
    const items = (list.items as Array<Record<string, unknown>>) ?? []
    return {
      id: list.id,
      name: list.name,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        displayPrice: item.displayPrice,
        ...(item.description ? { description: item.description } : {}),
        ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
        ...(item.ratingDisplayString ? { ratingDisplayString: item.ratingDisplayString } : {}),
      })),
    }
  })

  return {
    storeHeader: header,
    menuBook,
    itemLists: trimmedItems,
  }
}

const adapter: CustomRunner = {
  name: 'doordash-read',
  description: 'DoorDash — read operations with response trimming',

  async run(ctx) {
    switch (ctx.operation) {
      case 'searchRestaurants':
        return searchRestaurants(ctx)
      case 'getRestaurantMenu':
        return getRestaurantMenu(ctx)
      default:
        throw ctx.helpers.errors.unknownOp(ctx.operation)
    }
  },
}

export default adapter
