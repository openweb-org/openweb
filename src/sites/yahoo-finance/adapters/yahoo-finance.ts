import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

type Params = Readonly<Record<string, unknown>>
type Errors = AdapterErrorHelpers
type R = Record<string, unknown>

const Q1 = 'https://query1.finance.yahoo.com'
const Q2 = 'https://query2.finance.yahoo.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'

async function fetchJson(url: string, errors: Errors): Promise<R> {
  const { status, text } = await nodeFetch({
    url, method: 'GET', timeout: 20_000,
    headers: { 'User-Agent': UA },
  })
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function qs(params: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '')
      parts.push(`${k}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

function raw(v: unknown): unknown {
  if (v && typeof v === 'object' && 'raw' in (v as R)) return (v as R).raw
  return v
}

// ── Trim helpers ───────────────────────────────────────

function trimScreenerQuote(q: R): R {
  return {
    symbol: q.symbol,
    shortName: q.shortName ?? q.displayName,
    quoteType: q.quoteType,
    exchange: q.fullExchangeName ?? q.exchange,
    regularMarketPrice: raw(q.regularMarketPrice),
    regularMarketChange: raw(q.regularMarketChange),
    regularMarketChangePercent: raw(q.regularMarketChangePercent),
    regularMarketVolume: raw(q.regularMarketVolume),
    marketCap: raw(q.marketCap),
    fiftyTwoWeekHigh: raw(q.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: raw(q.fiftyTwoWeekLow),
    trailingPE: raw(q.trailingPE) ?? null,
    forwardPE: raw(q.forwardPE) ?? null,
    dividendYield: raw(q.dividendYield) ?? null,
    averageAnalystRating: q.averageAnalystRating ?? null,
    marketState: q.marketState,
  }
}

function trimSparkMeta(meta: R): R {
  return {
    currency: meta.currency,
    symbol: meta.symbol,
    regularMarketPrice: meta.regularMarketPrice,
    previousClose: meta.previousClose,
    chartPreviousClose: meta.chartPreviousClose,
  }
}

function trimInsightResult(item: R): R {
  const secReports = item.secReports as R[] | undefined
  const sigDevs = item.sigDevs as R[] | undefined
  const trimmed: R = {
    symbol: item.symbol,
    instrumentInfo: item.instrumentInfo,
  }
  if (item.companySnapshot) trimmed.companySnapshot = item.companySnapshot
  if (item.recommendation) trimmed.recommendation = item.recommendation
  if (sigDevs?.length) trimmed.sigDevs = sigDevs.slice(0, 5)
  if (secReports?.length) {
    trimmed.secReports = secReports.slice(0, 10).map(r => ({
      type: r.type,
      title: r.title,
      formType: r.formType,
      filingDate: r.filingDate,
    }))
  }
  return trimmed
}

function trimCalendarDay(day: R): R {
  const records = day.records as R[] | undefined
  return {
    timestampString: day.timestampString,
    count: day.count,
    totalCount: day.totalCount,
    records: records ?? [],
  }
}

function trimEarningsRecord(r: R): R {
  return {
    ticker: r.ticker,
    companyShortName: r.companyShortName,
    startDateTime: r.startDateTime,
    fiscalYear: r.fiscalYear,
    quarter: r.quarter,
    epsActual: r.epsActual ?? null,
    epsEstimate: r.epsEstimate ?? null,
    surprisePercent: r.surprisePercent ?? null,
  }
}

function trimEconRecord(r: R): R {
  return {
    event: r.event,
    countryCode: r.countryCode,
    eventTime: r.eventTime,
    period: r.period,
    prior: r.prior ?? null,
  }
}

function trimIpoRecord(r: R): R {
  return {
    ticker: r.ticker,
    companyShortName: r.companyShortName,
    exchangeShortName: r.exchangeShortName,
    startDateTime: r.startDateTime,
    dealType: r.dealType,
  }
}

function trimSecRecord(r: R): R {
  return {
    type: r.type,
    ticker: r.ticker,
    companyName: r.companyName,
    filingDate: r.filingDate,
    category: r.category,
  }
}

function trimCalendarEventType(
  days: R[] | undefined,
  recordTrimmer: (r: R) => R,
  maxDays = 7,
): R[] {
  if (!days?.length) return []
  return days.slice(0, maxDays).map(day => {
    const base = trimCalendarDay(day)
    base.records = (base.records as R[]).map(recordTrimmer)
    return base
  })
}

// ── Operations ─────────────────────────────────────────

async function searchTickers(params: Params, errors: Errors): Promise<unknown> {
  return fetchJson(`${Q1}/v1/finance/search${qs({
    q: params.q, quotesCount: params.quotesCount, newsCount: params.newsCount,
    lang: params.lang, region: params.region,
  })}`, errors)
}

async function getChart(params: Params, errors: Errors): Promise<unknown> {
  const symbol = params.symbol as string
  return fetchJson(`${Q1}/v8/finance/chart/${encodeURIComponent(symbol)}${qs({
    interval: params.interval, period1: params.period1, period2: params.period2,
    range: params.range, events: params.events, includePrePost: params.includePrePost,
    lang: params.lang, region: params.region,
  })}`, errors)
}

async function getSparkline(params: Params, errors: Errors): Promise<unknown> {
  const data = await fetchJson(`${Q1}/v7/finance/spark${qs({
    symbols: params.symbols, range: params.range, interval: params.interval,
    indicators: params.indicators, includeTimestamps: params.includeTimestamps,
  })}`, errors)

  const spark = data.spark as R
  const results = spark.result as R[]
  return {
    spark: {
      result: results.map(r => {
        const responses = r.response as R[]
        return {
          symbol: r.symbol,
          response: responses.map(resp => ({
            meta: trimSparkMeta(resp.meta as R),
            timestamp: resp.timestamp,
            indicators: resp.indicators,
          })),
        }
      }),
      error: spark.error,
    },
  }
}

async function getScreener(params: Params, errors: Errors): Promise<unknown> {
  const data = await fetchJson(`${Q1}/v1/finance/screener/predefined/saved${qs({
    scrIds: params.scrIds, count: params.count, start: params.start,
    fields: params.fields, formatted: params.formatted,
    sortField: params.sortField, sortType: params.sortType,
    lang: params.lang, region: params.region,
  })}`, errors)

  const finance = data.finance as R
  const results = finance.result as R[]
  return {
    finance: {
      result: results.map(r => ({
        id: r.id,
        title: r.title,
        description: r.description,
        canonicalName: r.canonicalName,
        count: r.count,
        quotes: ((r.quotes as R[]) ?? []).map(trimScreenerQuote),
      })),
    },
  }
}

async function getRatings(params: Params, errors: Errors): Promise<unknown> {
  const symbol = params.symbol as string
  return fetchJson(`${Q1}/v2/ratings/top/${encodeURIComponent(symbol)}${qs({
    lang: params.lang, region: params.region,
  })}`, errors)
}

async function getInsights(params: Params, errors: Errors): Promise<unknown> {
  const data = await fetchJson(`${Q2}/ws/insights/v3/finance/insights${qs({
    symbols: params.symbols, reportsCount: params.reportsCount,
    lang: params.lang, region: params.region,
  })}`, errors)

  const finance = data.finance as R
  const results = finance.result as R[]
  return {
    finance: {
      result: results.map(trimInsightResult),
      error: finance.error,
    },
  }
}

async function getTimeSeries(params: Params, errors: Errors): Promise<unknown> {
  const symbol = params.symbol as string
  return fetchJson(`${Q2}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}${qs({
    type: params.type, period1: params.period1, period2: params.period2,
    padTimeSeries: params.padTimeSeries, lang: params.lang, region: params.region,
  })}`, errors)
}

async function getCalendarEvents(params: Params, errors: Errors): Promise<unknown> {
  const data = await fetchJson(`${Q2}/ws/screeners/v1/finance/calendar-events${qs({
    countPerDay: params.countPerDay, lang: params.lang, region: params.region,
  })}`, errors)

  const finance = data.finance as R
  const result = finance.result as R
  return {
    finance: {
      result: {
        earnings: trimCalendarEventType(result.earnings as R[] | undefined, trimEarningsRecord),
        ipoEvents: trimCalendarEventType(result.ipoEvents as R[] | undefined, trimIpoRecord),
        secReports: trimCalendarEventType(result.secReports as R[] | undefined, trimSecRecord),
        economicEvents: trimCalendarEventType(result.economicEvents as R[] | undefined, trimEconRecord),
      },
    },
  }
}

async function getQuoteType(params: Params, errors: Errors): Promise<unknown> {
  return fetchJson(`${Q2}/v1/finance/quoteType/${qs({
    symbol: params.symbol, lang: params.lang, region: params.region,
  })}`, errors)
}

// ── Adapter ────────────────────────────────────────────

type OpHandler = (params: Params, errors: Errors) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  searchTickers,
  getChart,
  getSparkline,
  getScreener,
  getRatings,
  getInsights,
  getTimeSeries,
  getCalendarEvents,
  getQuoteType,
}

const adapter: CustomRunner = {
  name: 'yahoo-finance',
  description: 'Yahoo Finance — response trimming for screener, insights, calendar events, sparklines',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
