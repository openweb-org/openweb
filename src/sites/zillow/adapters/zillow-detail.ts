import type { Page } from 'patchright'

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
  searchProperties,
}

const adapter = {
  name: 'zillow-detail',
  description:
    'Zillow search via region landing page __NEXT_DATA__ extraction. Bypasses PerimeterX by navigating to known region slugs.',

  async init(page: Page): Promise<boolean> {
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
    return handler(page, { ...params }, errors)
  },
}

export default adapter
