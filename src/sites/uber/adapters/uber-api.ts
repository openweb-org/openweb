import type { Page } from 'playwright-core'
import { OpenWebError, toOpenWebError } from '../../../lib/errors.js'
/**
 * Uber L3 adapter — Eats REST API via browser fetch.
 *
 * Uber Eats: REST at ubereats.com/_p/api/* (POST JSON, x-csrf-token: x)
 * Auth is via cookie_session (credentials: 'include' in browser fetch).
 */
import type { CodeAdapter } from '../../../types/adapter.js'

/* ---------- Eats REST ---------- */

const EATS_API_BASE = 'https://www.ubereats.com/_p/api'

/* ---------- helpers ---------- */

async function eatsPost(page: Page, endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const url = `${EATS_API_BASE}/${endpoint}`
  const result = await page.evaluate(
    async (args: { url: string; body: string }) => {
      const resp = await fetch(args.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'x' },
        body: args.body,
        credentials: 'include',
      })
      return { status: resp.status, text: await resp.text() }
    },
    { url, body: JSON.stringify(body) },
  )

  if (result.status >= 400) {
    throw OpenWebError.httpError(result.status)
  }

  const json = JSON.parse(result.text) as { status?: string; data?: unknown }
  return json.data ?? json
}

/* ---------- operation handlers ---------- */

async function searchRestaurants(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? '')

  const data = (await eatsPost(page, 'getSearchFeedV1', {
    userQuery: query,
    date: '',
    startTime: 0,
    endTime: 0,
    sortAndFilters: [],
    vertical: '',
    searchSource: '',
    displayType: 'SEARCH_RESULTS',
    searchType: '',
    keyName: '',
    cacheKey: '',
    recaptchaToken: '',
  })) as Record<string, unknown>

  const feedItems = (data.feedItems ?? []) as Array<Record<string, unknown>>
  const restaurants: unknown[] = []

  for (const item of feedItems) {
    if (item.type !== 'REGULAR_STORE') continue
    const store = item.store as Record<string, unknown> | undefined
    if (!store) continue

    const title = (store.title as Record<string, string>)?.text
    const rating = store.rating as Record<string, string> | undefined
    const image = store.image as Record<string, unknown> | undefined
    const imageItems = (image?.items ?? []) as Array<Record<string, unknown>>
    const imageUrl = imageItems[0]?.url as string | undefined

    const meta = (store.meta ?? []) as Array<Record<string, string>>
    const etdMeta = meta.find((m) => m.badgeType === 'ETD')
    const deliveryFeeMeta = meta.find((m) => m.badgeType === 'MembershipBenefit' || m.text?.includes('Delivery Fee'))

    restaurants.push({
      storeUuid: store.storeUuid,
      name: title,
      rating: rating?.text,
      ratingCount: rating?.accessibilityText,
      imageUrl,
      deliveryTime: etdMeta?.text,
      deliveryFee: deliveryFeeMeta?.text,
      actionUrl: store.actionUrl,
    })
  }

  return {
    restaurants,
    count: restaurants.length,
    totalResults: data.subtitle ? String(data.subtitle) : undefined,
  }
}

async function getEatsOrderHistory(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const lastWorkflowUUID = (params.lastWorkflowUUID as string) ?? ''

  const data = (await eatsPost(page, 'getPastOrdersV1', {
    lastWorkflowUUID,
  })) as Record<string, unknown>

  const ordersMap = (data.ordersMap ?? {}) as Record<string, Record<string, unknown>>
  const orderUuids = (data.orderUuids ?? []) as string[]
  const paginationData = data.paginationData as Record<string, string> | undefined
  const meta = data.meta as Record<string, boolean> | undefined

  const orders = orderUuids.map((uuid) => {
    const order = ordersMap[uuid]
    if (!order) return null
    const base = order.baseEaterOrder as Record<string, unknown>
    const storeInfo = order.storeInfo as Record<string, unknown>
    const fareInfo = order.fareInfo as Record<string, unknown>
    const cart = base?.shoppingCart as Record<string, unknown>
    const items = ((cart?.items ?? []) as Array<Record<string, unknown>>).map((i) => ({
      title: i.title,
      price: i.price,
      quantity: i.quantity,
    }))

    return {
      uuid: base?.uuid,
      storeName: (storeInfo as Record<string, unknown>)?.title,
      storeUuid: (storeInfo as Record<string, unknown>)?.uuid,
      completedAt: base?.completedAt,
      isCancelled: base?.isCancelled,
      isCompleted: base?.isCompleted,
      totalPrice: fareInfo?.totalPrice,
      items,
    }
  }).filter(Boolean)

  return {
    orders,
    count: orders.length,
    hasMore: meta?.hasMore ?? false,
    nextCursor: paginationData?.nextCursor,
  }
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  searchRestaurants,
  getEatsOrderHistory,
}

const adapter: CodeAdapter = {
  name: 'uber-api',
  description: 'Uber — Eats restaurant search, Eats order history',

  async init(page: Page): Promise<boolean> {
    const url = page.url()
    return url.includes('uber.com') || url.includes('ubereats.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const uberCookies = await page.context().cookies('https://www.ubereats.com')
    return uberCookies.some((c) => c.name === 'sid' || c.name === 'csid' || c.name === 'jwt-session')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    try {
      const handler = OPERATIONS[operation]
      if (!handler) {
        throw OpenWebError.unknownOp(operation)
      }
      return await handler(page, { ...params })
    } catch (error) {
      throw toOpenWebError(error)
    }
  },
}

export default adapter
