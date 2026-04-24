import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

/**
 * Zillow search adapter — navigates to a region landing page and extracts
 * __NEXT_DATA__.searchPageState.cat1. The async-create-search-page-state
 * endpoint is blocked by PerimeterX, so we use the region slug heuristic
 * and drop the full request body.
 *
 * Property detail / zestimate / neighborhood operations are handled via
 * the spec-level x-openweb.extraction (page_global_data) and do not need
 * this adapter.
 *
 * Bot detection: PerimeterX — navigate to about:blank, clear cookies, retry.
 */

/** Detect stale/closed page errors (verify warm-up + PX can close the tab). */
function isStalePage(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return (
    msg.includes('Cannot find parent object') ||
    msg.includes('has been closed') ||
    msg.includes('Target closed')
  )
}

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
      await page.goto('about:blank').catch(() => {})
      await page.context().clearCookies()
      await new Promise((r) => setTimeout(r, 1000))
    }
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 15_000 })
    } catch (e) {
      if (isStalePage(e)) {
        await page.goto('about:blank').catch(() => {})
        await page.context().clearCookies().catch(() => {})
        await new Promise((r) => setTimeout(r, 500))
        continue
      }
    }
    const title = await page.title().catch(() => '')
    if (!title.includes('Access to this page has been denied')) return true
  }
  return false
}

/* ---------- Response trimming ---------- */

const SALE_KEEP = new Set([
  'zpid', 'detailUrl', 'statusType', 'statusText', 'price', 'unformattedPrice',
  'address', 'addressStreet', 'addressCity', 'addressState', 'addressZipcode',
  'beds', 'baths', 'area', 'latLong', 'imgSrc', 'zestimate',
  'hdpData', 'has3DModel', 'hasVideo', 'isFeaturedListing',
])

const RENTAL_KEEP = new Set([
  'zpid', 'detailUrl', 'statusType', 'statusText',
  'address', 'addressStreet', 'addressCity', 'addressState', 'addressZipcode',
  'latLong', 'imgSrc', 'isFeaturedListing',
  'buildingName', 'minBaseRent', 'maxBaseRent', 'availabilityCount', 'units',
])

function trimHdpData(hdp: Record<string, unknown>): Record<string, unknown> | undefined {
  const info = hdp?.homeInfo as Record<string, unknown> | undefined
  if (!info) return undefined
  const keep = [
    'zpid', 'streetAddress', 'zipcode', 'city', 'state', 'price',
    'bathrooms', 'bedrooms', 'livingArea', 'homeType', 'homeStatus',
    'daysOnZillow', 'zestimate', 'rentZestimate', 'taxAssessedValue',
    'lotAreaValue', 'lotAreaUnit',
  ]
  const trimmed: Record<string, unknown> = {}
  for (const k of keep) {
    if (info[k] != null) trimmed[k] = info[k]
  }
  return Object.keys(trimmed).length ? { homeInfo: trimmed } : undefined
}

function trimListing(r: Record<string, unknown>): Record<string, unknown> {
  const isRental = r.isBuilding === true || r.statusType === 'FOR_RENT'
  const allowed = isRental ? RENTAL_KEEP : SALE_KEEP
  const out: Record<string, unknown> = {}
  for (const k of allowed) {
    if (r[k] != null) {
      if (k === 'hdpData') {
        const hd = trimHdpData(r[k] as Record<string, unknown>)
        if (hd) out[k] = hd
      } else {
        out[k] = r[k]
      }
    }
  }
  return out
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
      33839: 'san-jose-ca',
      11298: 'san-diego-ca',
      40326: 'phoenix-az',
      18959: 'dallas-tx',
      13945: 'nashville-tn',
      5983: 'charlotte-nc',
      47906: 'raleigh-nc',
      3101: 'boston-ma',
      24043: 'philadelphia-pa',
      13211: 'minneapolis-mn',
      394913: 'washington-dc',
      36086: 'atlanta-ga',
      25415: 'las-vegas-nv',
      27485: 'salt-lake-city-ut',
      42286: 'indianapolis-in',
      51921: 'columbus-oh',
      38128: 'tampa-fl',
      15108: 'detroit-mi',
      19701: 'pittsburgh-pa',
      31104: 'sacramento-ca',
      50290: 'kansas-city-mo',
      5880: 'orlando-fl',
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

  const raw = searchResults.searchResults ?? searchResults
  const listResults = Array.isArray(raw.listResults) ? raw.listResults.slice(0, 20) : []
  const trimmed = listResults.map(trimListing)

  return {
    cat1: {
      searchResults: {
        listResults: trimmed,
        totalResultCount:
          searchResults.searchList?.totalResultCount ?? listResults.length,
      },
    },
  }
}

/* ---------- Adapter export ---------- */

const OPERATIONS: Record<
  string,
  (page: Page, params: Record<string, unknown>, errors: AdapterErrors) => Promise<unknown>
> = {
  searchProperties,
}

const adapter: CustomRunner = {
  name: 'zillow-detail',
  description:
    'Zillow search via region landing page __NEXT_DATA__ extraction. Bypasses PerimeterX by navigating to known region slugs.',

  async run(ctx) {
    const { page: pageRaw, operation, params, helpers } = ctx
    const page = pageRaw as Page
    const { errors } = helpers as { errors: AdapterErrors }

    // Fold prior init(): clear PX cookies if page is currently denied
    try {
      const title = await page.title()
      if (title.includes('Access to this page has been denied')) {
        await page.context().clearCookies()
      }
    } catch (e) {
      if (isStalePage(e)) {
        await page.goto('about:blank').catch(() => {})
        await page.context().clearCookies().catch(() => {})
      }
    }

    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    try {
      return await handler(page, { ...params }, errors)
    } catch (error) {
      throw errors.wrap(error)
    }
  },
}

export default adapter
