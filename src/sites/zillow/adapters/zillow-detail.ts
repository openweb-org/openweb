import type { Page } from 'patchright'

/**
 * Zillow property detail adapter — extracts property data from __NEXT_DATA__
 * via page navigation.
 *
 * PerimeterX blocks all in-page fetch() and page.request.fetch() calls to
 * the /graphql/ endpoint. Instead, we navigate directly to the property
 * detail page and extract data from the server-rendered __NEXT_DATA__ script.
 *
 * The gdpClientCache in __NEXT_DATA__ contains the same GraphQL response
 * data that the /graphql/ endpoint would return (118+ fields).
 *
 * Bot detection: PerimeterX — navigate to about:blank, clear cookies, retry.
 */

type AdapterErrors = {
  unknownOp(op: string): Error
  missingParam(p: string): Error
  botBlocked(msg: string): Error
  wrap(error: unknown): Error
}

/** Navigate to a URL, retrying with cookie clears if PerimeterX blocks. */
async function navigateWithPxRetry(page: Page, url: string, maxRetries = 4): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      // Navigate away from CAPTCHA page, clear cookies, wait
      await page.goto('about:blank').catch(() => {})
      await page.context().clearCookies()
      await new Promise((r) => setTimeout(r, 1000))
    }
    await page.goto(url, { waitUntil: 'load', timeout: 15_000 }).catch(() => {})
    const title = await page.title().catch(() => '')
    if (!title.includes('Access to this page has been denied')) return true
  }
  return false
}

// Cache: zpid → extracted property data (avoids re-navigation for same property)
const propertyCache = new Map<number, Record<string, unknown>>()

/** Navigate to a Zillow property page with PX retry. */
async function navigateToProperty(page: Page, zpid: number | string): Promise<void> {
  // Skip navigation if already on the right property page
  const currentUrl = page.url()
  if (currentUrl.includes(`/${zpid}_zpid/`)) {
    const title = await page.title().catch(() => '')
    if (!title.includes('Access to this page has been denied')) return
  }

  const url = `https://www.zillow.com/homedetails/_/${zpid}_zpid/`
  const ok = await navigateWithPxRetry(page, url)
  if (!ok) {
    // Last resort: one more attempt with longer delay
    await new Promise((r) => setTimeout(r, 3000))
    await page.goto(url, { waitUntil: 'load', timeout: 15_000 }).catch(() => {})
  }
}

/** Extract property data from __NEXT_DATA__ gdpClientCache. */
async function extractPropertyFromPage(
  page: Page,
  errors: AdapterErrors,
): Promise<Record<string, unknown> | null> {
  const title = await page.title().catch(() => '')
  if (title.includes('Access to this page has been denied')) {
    throw errors.botBlocked('PerimeterX blocked property page (CAPTCHA)')
  }

  const property = await page.evaluate(() => {
    const el = document.querySelector('script#__NEXT_DATA__')
    if (!el?.textContent) return null

    const nextData = JSON.parse(el.textContent)
    const componentProps = nextData?.props?.pageProps?.componentProps
    if (!componentProps?.gdpClientCache) return null

    const cache = JSON.parse(componentProps.gdpClientCache)
    for (const value of Object.values(cache) as Array<Record<string, unknown>>) {
      if (value?.property) return value.property
    }
    return null
  })

  return property as Record<string, unknown> | null
}

/** Fetch property data: navigate to detail page + extract __NEXT_DATA__. */
async function fetchProperty(
  page: Page,
  zpid: number,
  errors: AdapterErrors,
): Promise<Record<string, unknown> | null> {
  const cached = propertyCache.get(zpid)
  if (cached) return cached

  await navigateToProperty(page, zpid)
  const result = await extractPropertyFromPage(page, errors)
  if (result) propertyCache.set(zpid, result)
  return result
}

/* ---------- getPropertyDetail ---------- */

async function getPropertyDetail(
  page: Page,
  params: Record<string, unknown>,
  errors: AdapterErrors,
): Promise<unknown> {
  const zpid = Number(params.zpid)
  const p = await fetchProperty(page, zpid, errors)
  if (!p) return null

  const addr = p.address as Record<string, unknown> | undefined
  const resoFacts = p.resoFacts as Record<string, unknown> | undefined
  const taxFirst = (p.taxHistory as Array<Record<string, unknown>>)?.[0]

  const photoSource =
    (Array.isArray(p.responsivePhotos) && p.responsivePhotos.length > 0 && p.responsivePhotos) ||
    (Array.isArray(p.compsCarouselPropertyPhotos) &&
      p.compsCarouselPropertyPhotos.length > 0 &&
      p.compsCarouselPropertyPhotos) ||
    (Array.isArray(p.thumb) && p.thumb) ||
    []
  const photos = (photoSource as Array<Record<string, unknown>>)
    .slice(0, 10)
    .map((ph) => ph.mixedSources ?? ph.url ?? null)

  return {
    zpid: p.zpid ?? null,
    address: addr
      ? {
          streetAddress: addr.streetAddress ?? null,
          city: addr.city ?? null,
          state: addr.state ?? null,
          zipcode: addr.zipcode ?? null,
        }
      : null,
    price: p.price ?? null,
    bedrooms: p.bedrooms ?? resoFacts?.bedrooms ?? null,
    bathrooms: p.bathrooms ?? resoFacts?.bathrooms ?? null,
    livingArea: p.livingAreaValue ?? resoFacts?.livingArea ?? null,
    livingAreaUnits: p.livingAreaUnitsShort ?? p.livingAreaUnits ?? 'sqft',
    lotSize: p.lotAreaValue ?? resoFacts?.lotSize ?? null,
    homeType: p.homeType ?? null,
    homeStatus: p.homeStatus ?? null,
    yearBuilt: resoFacts?.yearBuilt ?? null,
    description: p.description ?? null,
    zestimate: p.zestimate ?? null,
    rentZestimate: p.rentZestimate ?? null,
    taxAssessedValue: (taxFirst?.value as number) ?? null,
    daysOnZillow: p.daysOnZillow ?? null,
    pageViewCount: null,
    favoriteCount: null,
    photos,
    url: `https://www.zillow.com${p.hdpUrl || `/homedetails/_/${p.zpid}_zpid/`}`,
  }
}

/* ---------- getZestimate ---------- */

async function getZestimate(
  page: Page,
  params: Record<string, unknown>,
  errors: AdapterErrors,
): Promise<unknown> {
  const zpid = Number(params.zpid)
  const p = await fetchProperty(page, zpid, errors)
  if (!p) return null

  const addr = p.address as Record<string, unknown> | undefined
  const taxFirst = (p.taxHistory as Array<Record<string, unknown>>)?.[0]

  return {
    zpid: p.zpid ?? null,
    address: addr
      ? {
          streetAddress: addr.streetAddress ?? null,
          city: addr.city ?? null,
          state: addr.state ?? null,
          zipcode: addr.zipcode ?? null,
        }
      : null,
    zestimate: p.zestimate ?? null,
    rentZestimate: p.rentZestimate ?? null,
    zestimateLowPercent: p.zestimateLowPercent != null ? Number(p.zestimateLowPercent) : null,
    zestimateHighPercent: p.zestimateHighPercent != null ? Number(p.zestimateHighPercent) : null,
    taxAssessedValue: (taxFirst?.value as number) ?? null,
    taxAssessedYear: taxFirst?.time
      ? new Date(taxFirst.time as number).getFullYear()
      : null,
    price: p.price ?? null,
    homeType: p.homeType ?? null,
    livingArea: p.livingAreaValue ?? null,
    bedrooms: p.bedrooms ?? null,
    bathrooms: p.bathrooms ?? null,
    zestimateHistory: null,
  }
}

/* ---------- getNeighborhood ---------- */

async function getNeighborhood(
  page: Page,
  params: Record<string, unknown>,
  errors: AdapterErrors,
): Promise<unknown> {
  const zpid = Number(params.zpid)
  const p = await fetchProperty(page, zpid, errors)
  if (!p) return null

  const addr = p.address as Record<string, unknown> | undefined

  const schools = Array.isArray(p.schools)
    ? (p.schools as Array<Record<string, unknown>>).slice(0, 10).map((s) => ({
        name: (s.name as string) ?? null,
        rating: (s.rating as number) ?? null,
        level: (s.level as string) ?? (s.grades as string) ?? null,
        type: (s.type as string) ?? null,
        distance: (s.distance as number) ?? null,
        link: (s.link as string) ?? null,
      }))
    : null

  const nearbyHomes = Array.isArray(p.nearbyHomes)
    ? (p.nearbyHomes as Array<Record<string, unknown>>).slice(0, 10).map((h) => {
        const a = h.address as Record<string, unknown> | undefined
        return {
          zpid: (h.zpid as number) ?? null,
          address: (a?.streetAddress as string) ?? null,
          price: (h.price as number) ?? null,
          bedrooms: (h.bedrooms as number) ?? null,
          bathrooms: (h.bathrooms as number) ?? null,
          livingArea: (h.livingAreaValue as number) ?? (h.livingArea as number) ?? null,
          homeType: (h.homeType as string) ?? null,
        }
      })
    : null

  return {
    zpid: p.zpid ?? null,
    address: addr
      ? {
          streetAddress: addr.streetAddress ?? null,
          city: addr.city ?? null,
          state: addr.state ?? null,
          zipcode: addr.zipcode ?? null,
        }
      : null,
    walkScore: null,
    transitScore: null,
    bikeScore: null,
    schools,
    nearbyHomes,
  }
}

/* ---------- searchProperties ---------- */

async function searchProperties(
  page: Page,
  params: Record<string, unknown>,
  errors: AdapterErrors,
): Promise<unknown> {
  const searchQueryState = params.searchQueryState as Record<string, unknown> | undefined
  const regionSelection = searchQueryState?.regionSelection as Array<Record<string, unknown>> | undefined
  const category = (searchQueryState?.category as string) ?? 'cat1'

  let searchUrl = 'https://www.zillow.com/san-francisco-ca/'
  if (regionSelection?.[0]?.regionId) {
    const regionId = regionSelection[0].regionId as number
    const knownRegions: Record<number, string> = {
      20330: 'san-francisco-ca',
      12447: 'los-angeles-ca',
      16037: 'seattle-wa',
      6181: 'chicago-il',
      33529: 'houston-tx',
      13271: 'miami-fl',
      17426: 'new-york-ny',
      54296: 'austin-tx',
      17885: 'denver-co',
      26396: 'portland-or',
    }
    const slug = knownRegions[regionId]
    if (slug) searchUrl = `https://www.zillow.com/${slug}/`
  }

  if (category === 'cat2') {
    searchUrl = searchUrl.replace(/\/$/, '/rentals/')
  }

  const ok = await navigateWithPxRetry(page, searchUrl)
  if (!ok) {
    throw errors.botBlocked('PerimeterX blocked search page (CAPTCHA)')
  }

  const searchResults = await page.evaluate(() => {
    const el = document.querySelector('script#__NEXT_DATA__')
    if (!el?.textContent) return null

    const nextData = JSON.parse(el.textContent)
    const pageProps = nextData?.props?.pageProps
    const componentProps = pageProps?.componentProps || pageProps
    const searchPageState = componentProps?.searchPageState

    if (searchPageState?.cat1?.searchResults) {
      return searchPageState.cat1
    }

    if (componentProps?.gdpClientCache) {
      const cache = JSON.parse(componentProps.gdpClientCache)
      for (const value of Object.values(cache) as Array<Record<string, unknown>>) {
        if (value?.cat1) return value.cat1
      }
    }

    return null
  })

  if (!searchResults) {
    return { cat1: { searchResults: { listResults: [], mapResults: [] } } }
  }

  return { cat1: searchResults }
}

/* ---------- Adapter export ---------- */

const OPERATIONS: Record<
  string,
  (page: Page, params: Record<string, unknown>, errors: AdapterErrors) => Promise<unknown>
> = {
  getPropertyDetail,
  getZestimate,
  getNeighborhood,
  searchProperties,
}

const adapter = {
  name: 'zillow-detail',
  description:
    'Zillow property data via __NEXT_DATA__ extraction. Bypasses PerimeterX by using page navigation instead of API calls.',

  async init(page: Page): Promise<boolean> {
    // If page is on PerimeterX CAPTCHA, clear all cookies immediately
    const title = await page.title().catch(() => '')
    if (title.includes('Access to this page has been denied')) {
      await page.context().clearCookies()
    }
    return true
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { errors } = helpers as { errors: AdapterErrors }
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)

    if (operation !== 'searchProperties' && !params.zpid) {
      throw errors.missingParam('zpid')
    }

    return handler(page, { ...params }, errors)
  },
}

export default adapter
