import type { Page } from 'patchright'

import type { CustomRunner } from '../../../types/adapter.js'

interface AdapterHelpers {
  pageFetch: (page: Page, opts: {
    url: string; method?: 'GET' | 'POST'; body?: string;
    headers?: Record<string, string>; timeout?: number
  }) => Promise<{ status: number; text: string }>
  errors: {
    unknownOp: (op: string, available: string[]) => Error
    missingParam: (name: string) => Error
    httpError: (status: number, body: string) => Error
    apiError: (context: string, message: string) => Error
    needsLogin: () => Error
    botBlocked: (msg: string) => Error
    fatal: (msg: string) => Error
    retriable: (msg: string) => Error
  }
}

const SA_API = 'https://seekingalpha.com/api/v3'

async function saFetch(
  page: Page, helpers: AdapterHelpers, path: string,
): Promise<unknown> {
  const result = await helpers.pageFetch(page, {
    url: `${SA_API}${path}`,
    method: 'GET',
    timeout: 15_000,
  })
  if (result.status === 403 || result.status === 429) {
    throw helpers.errors.botBlocked(
      `Seeking Alpha API returned ${result.status}. Bot detection may be active. Ensure the browser is headed and solve any CAPTCHA.`,
    )
  }
  if (result.status >= 400) {
    throw helpers.errors.retriable(`Seeking Alpha API returned ${result.status}: ${result.text.slice(0, 200)}`)
  }
  try {
    return JSON.parse(result.text)
  } catch {
    throw helpers.errors.fatal('Failed to parse Seeking Alpha API response as JSON')
  }
}

async function resolveTickerId(
  page: Page, helpers: AdapterHelpers, slug: string,
): Promise<number> {
  const body = await saFetch(page, helpers,
    `/searches?filter[query]=${encodeURIComponent(slug)}&filter[type]=symbols&page[size]=1&page[number]=1`,
  ) as { symbols?: Array<{ id: number; slug: string }> }
  const match = body.symbols?.[0]
  if (!match) throw helpers.errors.apiError('resolveTickerId', `No ticker found for "${slug}"`)
  return match.id
}

async function getStockAnalysis(
  page: Page, params: Record<string, unknown>, helpers: AdapterHelpers,
): Promise<unknown> {
  const ticker = String(params.ticker ?? '').toUpperCase()
  if (!ticker) throw helpers.errors.missingParam('ticker')
  const slug = ticker.toLowerCase()

  // Parallel: ratings + metrics + symbol data (valuation ratios)
  const [ratingsBody, metricsBody, symbolBody] = await Promise.all([
    saFetch(page, helpers,
      `/symbols/${ticker}/rating/periods?filter[periods][]=0&filter[periods][]=3&filter[periods][]=6`,
    ) as Promise<{ data?: Array<{ attributes?: Record<string, unknown>; meta?: Record<string, unknown> }> }>,
    saFetch(page, helpers,
      `/metrics?filter[fields]=marketcap,diluted_eps_growth,revenue_growth,div_yield_fwd&filter[slugs]=${slug}&minified=false`,
    ) as Promise<{ data?: unknown[]; included?: unknown[] }>,
    saFetch(page, helpers,
      `/symbol_data?fields[]=peRatioFwd&fields[]=lastClosePriceEarningsRatio&fields[]=divYield&fields[]=marketcap&slugs=${ticker}`,
    ) as Promise<{ data?: Array<{ id: string; attributes?: Record<string, unknown> }> }>,
  ])

  // Parse ratings
  const ratings = (ratingsBody.data ?? []).map(r => {
    const attrs = r.attributes ?? {}
    const meta = r.meta ?? {}
    const ratingsObj = (attrs.ratings ?? {}) as Record<string, unknown>
    return {
      asDate: attrs.asDate ?? null,
      period: meta.period ?? null,
      isLocked: meta.is_locked ?? false,
      quantRating: ratingsObj.quantRating ?? null,
      authorsRating: ratingsObj.authorsRating ?? null,
      sellSideRating: ratingsObj.sellSideRating ?? null,
      valueGrade: ratingsObj.valueGrade ?? null,
      growthGrade: ratingsObj.growthGrade ?? null,
      profitabilityGrade: ratingsObj.profitabilityGrade ?? null,
      momentumGrade: ratingsObj.momentumGrade ?? null,
    }
  })

  // Parse metrics
  const metricIncluded = ((metricsBody as any).included ?? []) as Array<{ id: string; type: string; attributes?: Record<string, unknown> }>
  const metricTypes = new Map(
    metricIncluded.filter(i => i.type === 'metric_type').map(i => [i.id, i.attributes?.field]),
  )
  const metrics: Record<string, unknown> = {}
  for (const d of (metricsBody.data ?? []) as Array<{ attributes?: { value?: unknown }; relationships?: { metric_type?: { data?: { id?: string } } } }>) {
    const typeId = d.relationships?.metric_type?.data?.id
    const field = typeId ? metricTypes.get(typeId) : null
    if (field) metrics[field as string] = d.attributes?.value ?? null
  }

  // Merge symbol_data valuation ratios into metrics
  const symbolAttrs = symbolBody.data?.[0]?.attributes ?? {}
  for (const [k, v] of Object.entries(symbolAttrs)) {
    if (v != null && !(k in metrics)) metrics[k] = v
  }

  return { ticker, ratings, metrics }
}

async function getEarnings(
  page: Page, params: Record<string, unknown>, helpers: AdapterHelpers,
): Promise<unknown> {
  const ticker = String(params.ticker ?? '').toUpperCase()
  if (!ticker) throw helpers.errors.missingParam('ticker')
  const slug = ticker.toLowerCase()

  // Resolve ticker ID for estimates API
  const tickerId = await resolveTickerId(page, helpers, ticker)

  // Parallel: estimates + transcripts
  const [estimatesBody, transcriptsBody] = await Promise.all([
    saFetch(page, helpers,
      `/symbol_data/estimates?estimates_data_items=eps_normalized_consensus_mean,eps_normalized_actual,revenue_consensus_mean,revenue_actual&period_type=quarterly&relative_periods=-4,-3,-2,-1,0,1,2&ticker_ids=${tickerId}`,
    ) as Promise<{ estimates?: Record<string, unknown> }>,
    saFetch(page, helpers,
      `/symbols/${slug}/transcripts?filter[until]=0&filter[only]=transcripts&id=${slug}&include=author,primaryTickers&page[number]=1&page[size]=5`,
    ) as Promise<{ data?: Array<{ id: string; attributes?: Record<string, unknown>; links?: Record<string, string> }>; included?: unknown[] }>,
  ])

  // Parse estimates
  const tickerEstimates = (estimatesBody.estimates as any)?.[String(tickerId)] ?? {}
  const estimates: Array<Record<string, unknown>> = []
  const periods = new Set<string>()

  for (const [item, periodData] of Object.entries(tickerEstimates as Record<string, Record<string, Array<{ dataitemvalue?: string; period?: Record<string, unknown> }>>>)) {
    for (const [relPeriod, entries] of Object.entries(periodData)) {
      const entry = entries[0]
      if (!entry) continue
      const key = `${relPeriod}`
      if (!periods.has(key)) {
        periods.add(key)
        estimates.push({
          relativePeriod: Number(relPeriod),
          fiscalYear: entry.period?.fiscalyear ?? null,
          fiscalQuarter: entry.period?.fiscalquarter ?? null,
          periodEndDate: entry.period?.periodenddate ?? null,
        })
      }
      const existing = estimates.find(e => e.relativePeriod === Number(relPeriod))
      if (existing) existing[item] = entry.dataitemvalue ? Number(entry.dataitemvalue) : null
    }
  }
  estimates.sort((a, b) => (a.relativePeriod as number) - (b.relativePeriod as number))

  // Parse transcripts
  const transcripts = (transcriptsBody.data ?? []).map(t => ({
    id: t.id,
    title: t.attributes?.title ?? null,
    publishedAt: t.attributes?.publishOn ?? null,
    isPaywalled: t.attributes?.isPaywalled ?? false,
    url: t.links?.self ?? null,
  }))

  return { ticker, tickerId, estimates, transcripts }
}

const operations: Record<string, (page: Page, params: Record<string, unknown>, helpers: AdapterHelpers) => Promise<unknown>> = {
  getStockAnalysis,
  getEarnings,
}

const adapter: CustomRunner = {
  name: 'seeking-alpha-api',
  description: 'Seeking Alpha — search articles, read articles, stock analysis, earnings data',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const p = page as Page
    const h = helpers as unknown as AdapterHelpers
    const handler = operations[operation]
    if (!handler) throw h.errors.unknownOp(operation, Object.keys(operations))
    try {
      const result = await handler(p, { ...params }, h)
      // SA embeds a dormant (0x0) PerimeterX #px-captcha div on every page.
      // Remove it so the generic bot-detect layer doesn't false-positive.
      await p.evaluate(() => document.querySelector('#px-captcha')?.remove()).catch(() => {})
      return result
    } catch (error) {
      throw (helpers.errors as unknown as { wrap(e: unknown): Error }).wrap(error)
    }
  },
}

export default adapter
