import type { Page, Response as PwResponse } from 'patchright'

/**
 * Skyscanner adapter — flight search via intercept, price calendar via browser fetch.
 *
 * Skyscanner uses a polling-based search API (/g/radar/api/v2/web-unified-search/).
 * Direct browser-side fetch returns 400 for search — must use intercept pattern:
 * navigate to the search URL and capture the API responses.
 *
 * Price calendar API works with browser-side fetch.
 *
 * Heavy bot detection: Cloudflare + PerimeterX + DataDome → page transport required.
 */

type ErrorHelpers = {
  unknownOp(op: string): Error
  missingParam(name: string): Error
  httpError(status: number): Error
  apiError(label: string, msg: string): Error
}

/* ---------- captcha helper ---------- */

async function solveCaptchaIfPresent(page: Page): Promise<void> {
  if (!page.url().includes('captcha')) return
  try {
    const el = page.locator('#px-captcha')
    if (await el.isVisible({ timeout: 3000 })) {
      const box = await el.boundingBox()
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await new Promise((r) => setTimeout(r, 8000))
        await page.mouse.up()
        // Wait for redirect after captcha solve
        await page.waitForURL((url) => !url.toString().includes('captcha'), { timeout: 15_000 }).catch(() => {})
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
  } catch {
    /* captcha may not always appear */
  }
}

/* ---------- ensure on skyscanner ---------- */

async function ensureOnSkyscanner(page: Page): Promise<void> {
  const url = page.url()
  if (url.includes('skyscanner.com') && !url.includes('captcha')) return
  await page.goto('https://www.skyscanner.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
  await solveCaptchaIfPresent(page)
}

/* ---------- intercept helper ---------- */

async function interceptSearchResults(
  page: Page,
  searchUrl: string,
  timeout = 40_000,
): Promise<unknown> {
  let lastResponse: Record<string, unknown> | null = null

  const handler = async (resp: PwResponse) => {
    try {
      if (!resp.url().includes('/g/radar/api/v2/web-unified-search/')) return
      const json = (await resp.json()) as Record<string, unknown>
      const ctx = json?.context as Record<string, unknown> | undefined
      const itin = json?.itineraries as Record<string, unknown> | undefined
      const results = itin?.results as unknown[] | undefined
      if (results && results.length > 0) lastResponse = json
      if (ctx?.status === 'complete') lastResponse = json
    } catch {
      /* ignore parse errors */
    }
  }

  page.on('response', handler)
  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {})
    await solveCaptchaIfPresent(page)

    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (lastResponse) {
        const ctx = (lastResponse.context as Record<string, unknown>) ?? {}
        if (ctx.status === 'complete') break
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  } finally {
    page.off('response', handler)
  }

  return lastResponse
}

/* ---------- operation handlers ---------- */

async function searchFlights(
  page: Page,
  params: Record<string, unknown>,
  errors: ErrorHelpers,
): Promise<unknown> {
  const origin = String(params.origin ?? 'LAX')
  const destination = String(params.destination ?? 'JFK')
  const date = String(params.date ?? params.departureDate ?? '')
  if (!date) throw errors.missingParam('date')

  const adults = Number(params.adults ?? 1)
  const cabinClass = String(params.cabinClass ?? 'economy').toLowerCase()
  const directOnly = params.directOnly === true || params.directOnly === 'true'

  // Build the search URL — Skyscanner uses IATA codes in the path and YYMMDD date format
  const [y, m, d] = date.split('-')
  const dateStr = y.slice(2) + m + d
  const searchUrl =
    `https://www.skyscanner.com/transport/flights/${origin.toLowerCase()}/${destination.toLowerCase()}/${dateStr}/` +
    `?adultsv2=${adults}&cabinclass=${cabinClass}&childrenv2=&rtn=0` +
    `&preferdirects=${directOnly}`

  const result = await interceptSearchResults(page, searchUrl)
  if (!result) {
    throw errors.apiError('searchFlights', 'No flight data captured — search may have been blocked')
  }

  const data = result as Record<string, unknown>
  return data.itineraries
}

async function getFlightDetail(
  page: Page,
  params: Record<string, unknown>,
  errors: ErrorHelpers,
): Promise<unknown> {
  // Flight detail uses the same search — Skyscanner returns full segment info in search results
  return searchFlights(page, params, errors)
}

async function getPriceHistory(
  page: Page,
  params: Record<string, unknown>,
  errors: ErrorHelpers,
): Promise<unknown> {
  const origin = String(params.origin ?? 'LAX')
  const destination = String(params.destination ?? 'JFK')

  // Ensure we're on skyscanner.com (prior ops may have navigated away)
  await ensureOnSkyscanner(page)

  // Price calendar API works with browser-side fetch
  const result = await page.evaluate(
    async (args: { origin: string; destination: string }) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 20_000)
      try {
        const resp = await fetch('/g/search-intent/v1/pricecalendar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            headers: {
              xSkyscannerClient: 'acorn',
              xSkyscannerCurrency: 'USD',
              xSkyscannerLocale: 'en-US',
              xSkyscannerMarket: 'US',
            },
            originRelevantFlightSkyId: args.origin,
            destinationRelevantFlightSkyId: args.destination,
          }),
          credentials: 'include',
          signal: ctrl.signal,
        })
        return { status: resp.status, text: await resp.text() }
      } finally {
        clearTimeout(timer)
      }
    },
    { origin: origin.toUpperCase(), destination: destination.toUpperCase() },
  )

  if (result.status >= 400) {
    throw errors.httpError(result.status)
  }

  return JSON.parse(result.text)
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<
  string,
  (page: Page, params: Record<string, unknown>, errors: ErrorHelpers) => Promise<unknown>
> = {
  searchFlights,
  getFlightDetail,
  getPriceHistory,
}

const adapter = {
  name: 'skyscanner',
  description: 'Skyscanner — flight search, detail, and price history',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('skyscanner.com')
  },

  async isAuthenticated(_page: Page): Promise<boolean> {
    return true // public search, no login required
  },

  async execute(
    page: Page,
    operation: string,
    params: Readonly<Record<string, unknown>>,
    helpers: Record<string, unknown>,
  ): Promise<unknown> {
    const { errors } = helpers as { errors: ErrorHelpers }
    const handler = OPERATIONS[operation]
    if (!handler) throw errors.unknownOp(operation)
    return handler(page, { ...params }, errors)
  },
}

export default adapter
