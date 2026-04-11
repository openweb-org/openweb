import type { Page } from 'patchright'

/**
 * Zillow property detail adapter — fetches property, Zestimate, and
 * neighborhood data via GraphQL persisted query (page.evaluate fetch).
 *
 * Transport upgrade: SSR __NEXT_DATA__ → page.evaluate(fetch('/graphql'))
 * - Zero page navigation per property (only need to be on zillow.com domain)
 * - Single GraphQL persisted query returns 85+ fields per property
 * - CSRF satisfied by x-caller-id header
 * - Bot detection: PerimeterX — requires page transport with real Chrome session
 */

type PageFetch = (
  page: Page,
  options: {
    url: string
    method?: 'GET' | 'POST'
    headers?: Record<string, string>
    credentials?: 'same-origin' | 'include'
    timeout?: number
  },
) => Promise<{ status: number; text: string }>

type AdapterErrors = {
  unknownOp(op: string): Error
  missingParam(p: string): Error
  wrap(error: unknown): Error
}

/** Persisted query hash for the full property detail query (85+ fields). */
const PROPERTY_DETAIL_HASH = '3b51e213e2bc8dbf539cdb31f809991a62e1f5ce3cc0d011a8391839e024fa4e'

/** Ensure page is on zillow.com domain so same-origin fetch works. */
async function ensureOnZillow(page: Page): Promise<void> {
  if (!page.url().includes('zillow.com')) {
    await page.goto('https://www.zillow.com/', { waitUntil: 'load', timeout: 30_000 }).catch(() => {})
  }
}

/** Fetch full property data via GraphQL persisted query. */
async function fetchProperty(
  page: Page,
  zpid: number,
  pageFetch: PageFetch,
): Promise<Record<string, unknown> | null> {
  await ensureOnZillow(page)

  const params = new URLSearchParams({
    extensions: JSON.stringify({
      persistedQuery: { version: 1, sha256Hash: PROPERTY_DETAIL_HASH },
    }),
    variables: JSON.stringify({ zpid, altId: null, deviceTypeV2: 'WEB_DESKTOP' }),
  })

  const result = await pageFetch(page, {
    url: `/graphql/?${params}`,
    method: 'GET',
    headers: { 'x-caller-id': 'openweb' },
    credentials: 'include',
  })

  const data = JSON.parse(result.text) as { data?: { property?: Record<string, unknown> } }
  return data?.data?.property ?? null
}

/* ---------- getPropertyDetail ---------- */

async function getPropertyDetail(
  page: Page,
  params: Record<string, unknown>,
  pageFetch: PageFetch,
): Promise<unknown> {
  const zpid = Number(params.zpid)
  const p = await fetchProperty(page, zpid, pageFetch)
  if (!p) return null

  const addr = p.address as Record<string, unknown> | undefined
  const resoFacts = p.resoFacts as Record<string, unknown> | undefined
  const taxFirst = (p.taxHistory as Array<Record<string, unknown>>)?.[0]

  // Photos: try responsivePhotos → compsCarouselPropertyPhotos → thumb
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
  pageFetch: PageFetch,
): Promise<unknown> {
  const zpid = Number(params.zpid)
  const p = await fetchProperty(page, zpid, pageFetch)
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
    zestimateLowPercent: null,
    zestimateHighPercent: null,
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
  pageFetch: PageFetch,
): Promise<unknown> {
  const zpid = Number(params.zpid)
  const p = await fetchProperty(page, zpid, pageFetch)
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
    : []

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
    : []

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

/* ---------- Adapter export ---------- */

const OPERATIONS: Record<
  string,
  (page: Page, params: Record<string, unknown>, pageFetch: PageFetch) => Promise<unknown>
> = {
  getPropertyDetail,
  getZestimate,
  getNeighborhood,
}

const adapter = {
  name: 'zillow-detail',
  description:
    'Zillow property detail — GraphQL persisted query via page.evaluate(fetch). Zero DOM, zero SSR parsing.',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('zillow.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // Property details are publicly accessible
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { pageFetch, errors } = helpers as { pageFetch: PageFetch; errors: AdapterErrors }
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    if (!params.zpid) throw errors.missingParam('zpid')
    return handler(page, { ...params }, pageFetch)
  },
}

export default adapter
