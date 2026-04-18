import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

/**
 * Uber Rides adapter — location search, fare estimates, ride history via GraphQL.
 *
 * Transport: Tier 5 (page.evaluate + fetch). Zero DOM selectors.
 *
 * Endpoints:
 * - m.uber.com/go/graphql: PudoLocationSearch, Products
 * - riders.uber.com/graphql: Activities
 */

type Errors = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  fatal(msg: string): Error
  retriable(msg: string): Error
  wrap(error: unknown): Error
}

type Helpers = {
  pageFetch: (page: Page, opts: { url: string; method?: string; body?: string; headers?: Record<string, string>; timeout?: number }) => Promise<{ status: number; text: string }>
  errors: Errors
}

const GQL_HEADERS = { 'content-type': 'application/json', 'x-csrf-token': 'x' }

async function gqlCall(page: Page, helpers: Helpers, endpoint: string, body: unknown): Promise<any> {
  // Same-origin guard: pageFetch from a cross-origin page yields opaque CORS failures
  // ("Failed to fetch"). We guarantee the page hostname matches the GraphQL host.
  const endpointHost = new URL(endpoint).hostname
  const pageHost = (() => { try { return new URL(page.url()).hostname } catch { return '' } })()
  if (pageHost !== endpointHost) {
    throw helpers.errors.retriable(`page on ${pageHost || 'about:blank'} but GraphQL endpoint is ${endpointHost} — same-origin nav required`)
  }
  const resp = await helpers.pageFetch(page, {
    url: endpoint,
    method: 'POST',
    headers: GQL_HEADERS,
    body: JSON.stringify(body),
    timeout: 15_000,
  })
  if (resp.status !== 200) {
    if (resp.status === 401 || resp.status === 403) throw helpers.errors.needsLogin()
    throw helpers.errors.fatal(`GraphQL returned ${resp.status}`)
  }
  const data = JSON.parse(resp.text)
  if (data.errors?.length) {
    const msg = data.errors.map((e: { message: string }) => e.message).join('; ')
    // Uber returns {message:"not found"} for unauthenticated GraphQL calls — surface as needs_login
    // so the runtime auth cascade (refreshProfile + Tier 4) can recover instead of dying as fatal.
    if (/not found|unauthorized|unauthenticated/i.test(msg)) throw helpers.errors.needsLogin()
    throw helpers.errors.fatal(`GraphQL error: ${msg}`)
  }
  return data.data
}

async function ensurePage(page: Page, origin: string, helpers: Helpers): Promise<void> {
  const targetHost = new URL(origin).hostname
  // Always re-navigate: prior verify ops may leave the page on a different
  // uber subdomain (m.uber.com vs riders.uber.com vs auth.uber.com), and
  // a passing hostname check immediately after goto() can race a client-side
  // SPA redirect into auth.uber.com.
  try {
    await page.goto(origin, { waitUntil: 'load', timeout: 25_000 })
  } catch (err) {
    throw helpers.errors.retriable(`navigation to ${origin} failed: ${(err as Error).message}`)
  }
  // Allow client-side redirects (auth bounce) to settle before hostname check.
  await page.waitForTimeout(3000)
  const finalUrl = page.url()
  const finalHost = (() => { try { return new URL(finalUrl).hostname } catch { return '' } })()
  if (finalHost === 'auth.uber.com' || finalHost === 'login.uber.com') {
    throw helpers.errors.needsLogin()
  }
  if (finalHost !== targetHost) {
    throw helpers.errors.retriable(`expected ${targetHost} after nav, got ${finalUrl}`)
  }
}

// ── searchLocations ──────────────────────────────

const PUDO_QUERY = `query PudoLocationSearch($latitude: Float!, $longitude: Float!, $query: String!, $type: EnumRVWebCommonPickupOrDropoff!) {
  pudoLocationSearch(latitude: $latitude, longitude: $longitude, query: $query, type: $type) {
    id addressLine1 addressLine2 type source provider
    coordinate { latitude longitude }
  }
}`

async function searchLocations(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const query = String(params.query || '')
  const latitude = Number(params.latitude) || 0
  const longitude = Number(params.longitude) || 0
  const type = String(params.type || 'PICKUP').toUpperCase()

  if (!query) throw helpers.errors.missingParam('query')

  await ensurePage(page, 'https://m.uber.com/go/home', helpers)

  const data = await gqlCall(page, helpers, 'https://m.uber.com/go/graphql', {
    operationName: 'PudoLocationSearch',
    variables: { latitude, longitude, query, type },
    query: PUDO_QUERY,
  })

  return {
    locations: (data.pudoLocationSearch || []).map((loc: Record<string, unknown>) => ({
      id: loc.id,
      name: loc.addressLine1,
      address: loc.addressLine2,
      latitude: (loc.coordinate as Record<string, number>)?.latitude,
      longitude: (loc.coordinate as Record<string, number>)?.longitude,
      type: loc.type,
      source: loc.source,
    })),
  }
}

// ── getRideEstimate ──────────────────────────────

const PRODUCTS_QUERY = `query Products($destinations: [InputCoordinate!]!, $pickup: InputCoordinate!) {
  products(destinations: $destinations, pickup: $pickup) {
    tiers {
      products {
        displayName description estimatedTripTime etaStringShort cityID currencyCode
        fares { capacity fare fareAmountE5 }
      }
    }
    defaultVVID productsUnavailableMessage
  }
}`

async function getRideEstimate(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const pickup = params.pickup as { latitude: number; longitude: number } | undefined
  const destination = params.destination as { latitude: number; longitude: number } | undefined

  if (!pickup?.latitude || !pickup?.longitude) throw helpers.errors.missingParam('pickup (with latitude/longitude)')
  if (!destination?.latitude || !destination?.longitude) throw helpers.errors.missingParam('destination (with latitude/longitude)')

  await ensurePage(page, 'https://m.uber.com/go/home', helpers)

  const data = await gqlCall(page, helpers, 'https://m.uber.com/go/graphql', {
    operationName: 'Products',
    variables: {
      destinations: [{ latitude: destination.latitude, longitude: destination.longitude }],
      pickup: { latitude: pickup.latitude, longitude: pickup.longitude },
    },
    query: PRODUCTS_QUERY,
  })

  const products = data.products
  const rides = []
  for (const tier of products?.tiers || []) {
    for (const p of tier.products || []) {
      const fare = p.fares?.[0]
      rides.push({
        displayName: p.displayName,
        description: p.description,
        fare: fare?.fare,
        fareAmountCents: fare?.fareAmountE5 ? Math.round(fare.fareAmountE5 / 1000) : null,
        capacity: fare?.capacity,
        estimatedTripTimeSec: p.estimatedTripTime,
        etaString: p.etaStringShort,
        currencyCode: p.currencyCode,
      })
    }
  }

  return {
    rides,
    unavailableMessage: products?.productsUnavailableMessage || null,
  }
}

// ── getRideHistory ──────────────────────────────

const ACTIVITIES_QUERY = `query Activities($limit: Int = 10, $nextPageToken: String, $orderTypes: [RVWebCommonActivityOrderType!] = [RIDES, TRAVEL], $profileType: RVWebCommonActivityProfileType = PERSONAL) {
  activities {
    cityID
    past(limit: $limit, nextPageToken: $nextPageToken, orderTypes: $orderTypes, profileType: $profileType) {
      activities { uuid title subtitle description cardURL }
      nextPageToken
    }
  }
}`

async function getRideHistory(page: Page, params: Record<string, unknown>, helpers: Helpers): Promise<unknown> {
  const limit = Number(params.limit) || 10
  const nextPageToken = params.nextPageToken ? String(params.nextPageToken) : undefined

  await ensurePage(page, 'https://riders.uber.com/trips', helpers)

  const data = await gqlCall(page, helpers, 'https://riders.uber.com/graphql', {
    operationName: 'Activities',
    variables: { limit, nextPageToken },
    query: ACTIVITIES_QUERY,
  })

  const past = data.activities?.past
  return {
    rides: (past?.activities || []).map((a: Record<string, unknown>) => ({
      uuid: a.uuid,
      title: a.title,
      subtitle: a.subtitle,
      fare: a.description,
      detailUrl: a.cardURL,
    })),
    nextPageToken: past?.nextPageToken || null,
    hasMore: !!past?.nextPageToken,
  }
}

// ── Adapter export ──────────────────────────────

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>, helpers: Helpers) => Promise<unknown>> = {
  searchLocations,
  getRideEstimate,
  getRideHistory,
}

const adapter: CustomRunner = {
  name: 'uber-rides',
  description: 'Uber Rides — location search, fare estimates, ride history via GraphQL (Tier 5)',

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
