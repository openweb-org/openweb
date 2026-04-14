import type { Page } from 'patchright'

const SITE = 'https://www.opentable.com'
const GQL_URL = '/dapi/fe/gql'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* --- persisted query hashes --- */
const HASHES = {
  RestaurantsAvailability:
    'cbcf4838a9b399f742e3741785df64560a826d8d3cc2828aa01ab09a8455e29e',
  ReviewSearchResults:
    'a544a8bb7070a1aa6c5e50b3f9bb239ba44f442eb9ac628f30b57bd3ae098b27',
}

/* --- helpers --- */

async function getCsrfToken(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__CSRF_TOKEN__ ?? '')
}

async function gqlFetch(
  page: Page,
  opname: string,
  variables: Record<string, unknown>,
  hash: string,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const csrf = await getCsrfToken(page)
  const url = `${GQL_URL}?optype=query&opname=${opname}`
  const body = JSON.stringify({
    operationName: opname,
    variables,
    extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
  })
  const hdrs = JSON.stringify({
    'content-type': 'application/json',
    'x-csrf-token': csrf,
    ...extraHeaders,
  })
  return page.evaluate(
    async ([fetchUrl, fetchBody, headersJson]) => {
      const r = await fetch(fetchUrl, {
        method: 'POST',
        headers: JSON.parse(headersJson),
        credentials: 'include',
        body: fetchBody,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const json = await r.json()
      return json.data ?? json
    },
    [url, body, hdrs] as const,
  )
}

async function navigateAndWait(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
  await wait(5000)
}

/* --- operations --- */

async function searchRestaurants(
  page: Page,
  params: Record<string, unknown>,
  errors: { missingParam(name: string): Error },
) {
  const term = String(params.term || '')
  if (!term) throw errors.missingParam('term')
  const location = String(params.location || '')
  if (!location) throw errors.missingParam('location')
  const date = String(params.date || '')
  const time = String(params.time || '19:00')
  const covers = Number(params.covers) || 2
  const metroId = params.metroId ? String(params.metroId) : ''

  const url = new URL('/s', SITE)
  url.searchParams.set('term', term)
  if (date) {
    url.searchParams.set('dateTime', `${date}T${time.replace(':', '%3A')}`)
  }
  url.searchParams.set('covers', String(covers))
  if (metroId) url.searchParams.set('metroId', metroId)

  await navigateAndWait(page, url.toString())

  return page.evaluate(
    ([loc]) => {
      const state = (window as any).__INITIAL_STATE__
      const ms = state?.multiSearch
      if (!ms?.restaurants) return { restaurants: [], totalResults: 0 }

      const restaurants = ms.restaurants.map((r: any) => ({
        restaurantId: r.restaurantId,
        name: r.name,
        slug: r.urls?.profileLink?.link?.replace('https://www.opentable.com/r/', '') ?? null,
        cuisine: r.primaryCuisine?.name ?? null,
        priceBand: r.priceBand?.name ?? null,
        priceSymbol: r.priceBand?.currencySymbol
          ? r.priceBand.currencySymbol.repeat(r.priceBand.priceBandId ?? 1)
          : null,
        neighborhood: r.neighborhood?.name ?? null,
        rating: r.statistics?.reviews?.ratings?.overall?.rating ?? null,
        reviewCount: r.statistics?.reviews?.allTimeTextReviewCount ?? null,
        photos: r.photos?.gallery?.photos?.slice(0, 2).map((p: any) => p.thumbnails?.[0]?.url) ?? [],
        latitude: r.coordinates?.latitude ?? null,
        longitude: r.coordinates?.longitude ?? null,
        isPromoted: r.isPromoted ?? false,
      }))

      return {
        restaurants,
        totalResults: ms.totalRestaurantCount ?? restaurants.length,
        searchTerm: ms.freetextTerm ?? loc,
      }
    },
    [location] as const,
  )
}

async function getRestaurant(
  page: Page,
  params: Record<string, unknown>,
  errors: { missingParam(name: string): Error },
) {
  const slug = String(params.slug || '')
  if (!slug) throw errors.missingParam('slug')

  await navigateAndWait(page, `${SITE}/r/${slug}`)

  return page.evaluate(() => {
    const state = (window as any).__INITIAL_STATE__
    const r = state?.restaurantProfile?.restaurant
    if (!r) return null

    const stats = r.statistics?.reviews
    return {
      restaurantId: r.restaurantId,
      name: r.name,
      description: r.description ?? null,
      cuisine: r.primaryCuisine?.name ?? null,
      cuisines: r.cuisines?.map((c: any) => c.name) ?? [],
      priceBand: r.priceBand?.name ?? null,
      diningStyle: r.diningStyle ?? null,
      neighborhood: r.neighborhood?.name ?? null,
      address: r.address
        ? {
            line1: r.address.line1,
            city: r.address.city,
            state: r.address.state,
            postCode: r.address.postCode,
            country: r.address.country,
          }
        : null,
      phone: r.contactInformation?.formattedPhoneNumber ?? null,
      website: r.website ?? null,
      latitude: r.coordinates?.latitude ?? null,
      longitude: r.coordinates?.longitude ?? null,
      hoursOfOperation: r.hoursOfOperation ?? null,
      dressCode: r.dressCode ?? null,
      parkingDetails: r.parkingDetails ?? null,
      executiveChef: r.executiveChef ?? null,
      rating: stats?.ratings?.overall?.rating ?? null,
      reviewCount: stats?.allTimeTextReviewCount ?? null,
      ratings: stats?.ratings
        ? {
            overall: stats.ratings.overall?.rating ?? null,
            food: stats.ratings.food?.rating ?? null,
            service: stats.ratings.service?.rating ?? null,
            ambience: stats.ratings.ambience?.rating ?? null,
            value: stats.ratings.value?.rating ?? null,
          }
        : null,
      features: r.features
        ? {
            bar: r.features.bar ?? false,
            outdoor: r.features.outdoor ?? false,
            counter: r.features.counter ?? false,
            maxPartySize: r.features.reservationMaxPartySize ?? null,
          }
        : null,
      photos:
        r.photos?.gallery?.photos?.slice(0, 5).map((p: any) => p.thumbnails?.[0]?.url) ?? [],
    }
  })
}

async function getAvailability(
  page: Page,
  params: Record<string, unknown>,
  errors: { missingParam(name: string): Error },
) {
  const restaurantId = Number(params.restaurantId)
  if (!restaurantId) throw errors.missingParam('restaurantId')
  const date = String(params.date || '')
  if (!date) throw errors.missingParam('date')
  const time = String(params.time || '19:00')
  const partySize = Number(params.partySize) || 2

  const data = (await gqlFetch(page, 'RestaurantsAvailability', {
    restaurantIds: [restaurantId],
    date,
    time,
    partySize,
    databaseRegion: 'NA',
    onlyPop: false,
    forwardDays: 0,
    forwardMinutes: 210,
    backwardMinutes: 210,
    requireTimes: false,
    requireTypes: ['Standard', 'Experience', 'PrivateDining'],
    useCBR: false,
    privilegedAccess: [],
    restaurantAvailabilityTokens: [],
    loyaltyRedemptionTiers: [],
  }, HASHES.RestaurantsAvailability, {
    'ot-page-group': 'rest-profile',
    'ot-page-type': 'restprofilepage',
  })) as any

  const avail = data?.availability
  if (!avail) return { restaurantId, date, time, partySize, slots: [] }

  // The response is indexed (0, 1, 2...) — get first restaurant
  const entry = avail['0'] ?? Object.values(avail)[0] as any
  if (!entry?.availabilityDays?.[0]) {
    return { restaurantId, date, time, partySize, slots: [] }
  }

  const day = entry.availabilityDays[0]
  const slots = (day.slots || [])
    .filter((s: any) => s.isAvailable)
    .map((s: any) => ({
      timeOffsetMinutes: s.timeOffsetMinutes,
      type: s.type ?? 'Standard',
      seatingTypes: (s.attributes || []).filter((a: string) => a !== 'default'),
    }))

  return { restaurantId, date, time, partySize, slots }
}

async function getReviews(
  page: Page,
  params: Record<string, unknown>,
  errors: { missingParam(name: string): Error },
) {
  const restaurantId = Number(params.restaurantId)
  if (!restaurantId) throw errors.missingParam('restaurantId')
  const pageNum = Number(params.page) || 1
  const sortBy = String(params.sortBy || 'newestReview')

  const data = (await gqlFetch(page, 'ReviewSearchResults', {
    restaurantId,
    page: pageNum,
    pageSize: 10,
    sortBy,
    searchTerm: '',
    prioritiseUserLanguage: false,
    gpid: 0,
    highlightFormat: 'index',
  }, HASHES.ReviewSearchResults)) as any

  const rsr = data?.reviewSearchResults
  if (!rsr) return { reviews: [], totalCount: 0, totalPages: 0, page: pageNum }

  const reviews = (rsr.reviews || []).map((r: any) => ({
    reviewId: r.reviewId,
    rating: r.rating,
    text: r.text ?? null,
    displayName: r.user?.displayName ?? null,
    submittedDate: r.submittedDateTime ?? null,
    dinedDate: r.dinedDateTime ?? null,
    photos: r.photos?.map((p: any) => p.url) ?? [],
  }))

  return {
    reviews,
    totalCount: rsr.totalCount ?? 0,
    totalPages: rsr.totalPages ?? 0,
    page: pageNum,
  }
}

/* --- adapter export --- */

const adapter = {
  name: 'opentable',
  description: 'OpenTable — restaurant search, details, availability, reviews',

  async init(page: Page): Promise<boolean> {
    return new URL(page.url()).hostname.includes('opentable.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // All operations are public read
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { errors } = helpers as {
      errors: { unknownOp(op: string): Error; missingParam(name: string): Error }
    }
    switch (operation) {
      case 'searchRestaurants':
        return searchRestaurants(page, { ...params }, errors)
      case 'getRestaurant':
        return getRestaurant(page, { ...params }, errors)
      case 'getAvailability':
        return getAvailability(page, { ...params }, errors)
      case 'getReviews':
        return getReviews(page, { ...params }, errors)
      default:
        throw errors.unknownOp(operation)
    }
  },
}

export default adapter
