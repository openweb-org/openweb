import type { Page } from 'patchright'

import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

type Params = Readonly<Record<string, unknown>>
type Errors = AdapterErrorHelpers
type AnyRecord = Record<string, unknown>

/* ---------- helpers ---------- */

function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function parseMarketCap(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v
  if (typeof v === 'number') return String(v)
  return null
}

function downsample(pts: AnyRecord[], target: number): AnyRecord[] {
  if (pts.length <= target) return pts
  const step = pts.length / target
  const result: AnyRecord[] = []
  for (let i = 0; i < target; i++) {
    result.push(pts[Math.round(i * step)])
  }
  if (result[result.length - 1] !== pts[pts.length - 1]) {
    result.push(pts[pts.length - 1])
  }
  return result
}

/* ---------- SSR extraction ---------- */

async function extractNextData(page: Page): Promise<AnyRecord | null> {
  return page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__')
    if (!el) return null
    return JSON.parse(el.textContent!)
  })
}

/* ---------- getTickerBar ---------- */

const MAX_TICKER_ITEMS = 12

async function getTickerBar(page: Page): Promise<unknown> {
  const raw = await extractNextData(page)
  if (!raw) return []
  const items = (raw as AnyRecord).props as AnyRecord | undefined
  const pp = items?.pageProps as AnyRecord | undefined
  const state = pp?.initialState as AnyRecord | undefined
  const ticker = state?.tickerBar as AnyRecord[] | undefined
  if (!Array.isArray(ticker)) return []
  return ticker.slice(0, MAX_TICKER_ITEMS).map(t => ({
    id: t.id ?? null,
    shortName: t.shortName ?? null,
    price: parseNum(t.price),
    percentChange1Day: parseNum(t.percentChange1Day),
    lastYield: parseNum(t.lastYield),
  }))
}

/* ---------- getNewsHeadlines ---------- */

const MAX_HEADLINES = 25

async function getNewsHeadlines(page: Page): Promise<unknown> {
  const raw = await extractNextData(page)
  if (!raw) return { count: 0, items: [] }
  const pp = ((raw as AnyRecord).props as AnyRecord)?.pageProps as AnyRecord | undefined
  const state = pp?.initialState as AnyRecord | undefined
  const modules = state?.modulesById as AnyRecord | undefined
  if (!modules) return { count: 0, items: [] }

  const seen = new Set<string>()
  const items: AnyRecord[] = []
  for (const mod of Object.values(modules) as AnyRecord[]) {
    const stories = (mod?.stories || mod?.items || mod?.data) as AnyRecord[] | undefined
    if (!Array.isArray(stories)) continue
    for (const s of stories) {
      if (!s.headline || seen.has(s.id as string)) continue
      seen.add(s.id as string)
      items.push({
        id: s.id,
        headline: s.headline,
        abstract: s.abstract ?? null,
        url: s.url ?? null,
        publishedAt: s.publishedAt ?? null,
        byline: s.byline ?? null,
        brand: s.brand ?? s.brandLabel ?? null,
      })
    }
  }
  const trimmed = items.slice(0, MAX_HEADLINES)
  return { count: trimmed.length, items: trimmed }
}

/* ---------- getLatestNews ---------- */

async function getLatestNews(page: Page): Promise<unknown> {
  const raw = await extractNextData(page)
  if (!raw) return { count: 0, items: [] }
  const pp = ((raw as AnyRecord).props as AnyRecord)?.pageProps as AnyRecord | undefined
  const state = pp?.initialState as AnyRecord | undefined
  const modules = state?.modulesById as AnyRecord | undefined
  if (!modules) return { count: 0, items: [] }

  const latest = (modules.latest || modules.news_now || modules.shadow_latest) as AnyRecord | undefined
  if (!latest) return { count: 0, items: [] }
  const stories = (latest.stories || latest.items || latest.data) as AnyRecord[] | undefined
  if (!Array.isArray(stories)) return { count: 0, items: [] }

  const trimmed = stories.slice(0, 15).map(s => ({
    id: s.id,
    headline: s.headline,
    abstract: s.abstract ?? null,
    url: s.url ?? null,
    publishedAt: s.publishedAt ?? null,
    byline: s.byline ?? null,
    brand: s.brand ?? null,
  }))
  return { count: trimmed.length, items: trimmed }
}

/* ---------- getStockChart ---------- */

const PRICE_1Y_POINTS = 52
const PRICE_5Y_POINTS = 60

async function getStockChart(page: Page, _params: Params, errors: Errors): Promise<unknown> {
  const raw = await extractNextData(page)
  if (!raw) throw errors.retriable('No __NEXT_DATA__ on quote page')
  const pp = ((raw as AnyRecord).props as AnyRecord)?.pageProps as AnyRecord | undefined
  const state = pp?.initialState ?? pp
  if (!state) throw errors.retriable('No state in __NEXT_DATA__')
  const q = ((state as AnyRecord).quote ?? (state as AnyRecord).security ?? (pp as AnyRecord)?.quote ?? {}) as AnyRecord

  const mapPts = (arr: unknown): AnyRecord[] => {
    if (!Array.isArray(arr)) return []
    return arr.map((p: AnyRecord) => ({
      dateTime: p.dateTime ?? p.date ?? null,
      value: parseNum(p.value ?? p.price),
    }))
  }

  const h1y = mapPts(q.priceMovements1Year ?? (q.priceTimeSeries as AnyRecord)?.oneYear)
  const h5y = mapPts(q.priceMovements5Years ?? (q.priceTimeSeries as AnyRecord)?.fiveYear)

  return {
    ticker: q.ticker ?? q.id ?? null,
    name: q.name ?? q.longName ?? q.shortName ?? null,
    price: parseNum(q.price ?? q.lastPrice),
    currency: q.currency ?? q.priceCurrency ?? null,
    priceChange: parseNum(q.priceChange1Day ?? q.netChange),
    percentChange: parseNum(q.percentChange1Day ?? q.pctChange1Day),
    open: parseNum(q.openPrice ?? q.open),
    dayHigh: parseNum(q.highPrice ?? q.dayHigh),
    dayLow: parseNum(q.lowPrice ?? q.dayLow),
    previousClose: parseNum(q.previousClosingPriceOneTradingDayAgo ?? q.prevClose),
    volume: parseNum(q.volume),
    marketCap: parseMarketCap(q.marketCap),
    priceHistory1Y: downsample(h1y, PRICE_1Y_POINTS),
    priceHistory5Y: downsample(h5y, PRICE_5Y_POINTS),
  }
}

/* ---------- dispatch ---------- */

type Handler = (page: Page, params: Params, errors: Errors) => Promise<unknown>

const operations: Record<string, Handler> = {
  getTickerBar: (page) => getTickerBar(page),
  getNewsHeadlines: (page) => getNewsHeadlines(page),
  getLatestNews: (page) => getLatestNews(page),
  getStockChart,
}

const adapter: CustomRunner = {
  name: 'bloomberg',
  description: 'Bloomberg — response trimming for ticker, headlines, and stock chart data',

  async run(ctx) {
    const { page, operation, params, helpers } = ctx
    const handler = operations[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(page as Page, params, helpers.errors)
  },
}

export default adapter
