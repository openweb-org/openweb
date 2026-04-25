import type { Page } from 'patchright'

import type { AdapterErrorHelpers, CustomRunner, PreparedContext } from '../../../types/adapter.js'

type R = Record<string, unknown>
type Errors = AdapterErrorHelpers

// ── Fetch helpers ─────────────────────────────────────

function qs(params: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      parts.push(`${k}=${encodeURIComponent(String(v))}`)
    }
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

async function pageJson(
  page: Page,
  url: string,
  errors: Errors,
): Promise<R> {
  const result = await page.evaluate(
    async (fetchUrl: string) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20_000)
      try {
        const resp = await fetch(fetchUrl, {
          credentials: 'include',
          signal: controller.signal,
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })
        const text = await resp.text()
        return { status: resp.status, text }
      } catch (err) {
        return { status: 0, text: String(err) }
      } finally {
        clearTimeout(timer)
      }
    },
    url,
  )
  if (result.status === 0 || result.status >= 400) {
    throw errors.httpError(result.status)
  }
  try {
    return JSON.parse(result.text)
  } catch {
    throw errors.apiError('parse', `Non-JSON response (${result.text.slice(0, 200)})`)
  }
}

// ── HTML stripping ────────────────────────────────────

function stripHtml(s: unknown): string {
  if (typeof s !== 'string') return ''
  return s
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, '$1')
    .replace(/<a[^>]*>([^<]*)<\/a>/g, '$1')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .trim()
}

// ── Trim helpers ──────────────────────────────────────

function trimUser(u: R | undefined): R | undefined {
  if (!u) return undefined
  return {
    id: u.id,
    screen_name: u.screen_name,
    followers_count: u.followers_count,
    verified: u.verified,
  }
}

function trimPost(p: R): R {
  const desc = stripHtml(p.description)
  return {
    id: p.id,
    user_id: p.user_id,
    title: p.title ?? null,
    description: desc.length > 8000 ? `${desc.slice(0, 8000)}…` : desc,
    created_at: p.created_at,
    reply_count: p.reply_count ?? 0,
    retweet_count: p.retweet_count ?? 0,
    fav_count: p.fav_count ?? 0,
    user: trimUser(p.user as R | undefined),
  }
}

function trimQuoteItem(item: R): R {
  return {
    symbol: item.symbol,
    current: item.current,
    percent: item.percent,
    chg: item.chg,
    timestamp: item.timestamp,
    volume: item.volume,
    amount: item.amount,
    market_capital: item.market_capital,
    float_market_capital: item.float_market_capital ?? null,
    turnover_rate: item.turnover_rate,
    amplitude: item.amplitude,
    open: item.open,
    last_close: item.last_close,
    high: item.high,
    low: item.low,
    avg_price: item.avg_price,
    is_trade: item.is_trade,
    current_year_percent: item.current_year_percent,
  }
}

function trimOrderBook(data: R): R {
  const out: R = {
    symbol: data.symbol,
    timestamp: data.timestamp,
    current: data.current,
  }
  for (let i = 1; i <= 5; i++) {
    const bp = data[`bp${i}`]
    const bc = data[`bc${i}`]
    const sp = data[`sp${i}`]
    const sc = data[`sc${i}`]
    if (bp != null) out[`bp${i}`] = bp
    if (bc != null) out[`bc${i}`] = bc
    if (sp != null) out[`sp${i}`] = sp
    if (sc != null) out[`sc${i}`] = sc
  }
  out.buypct = data.buypct ?? null
  out.sellpct = data.sellpct ?? null
  return out
}

function trimFinancialItem(item: R): R {
  return {
    report_date: item.report_date,
    report_name: item.report_name,
    avg_roe: item.avg_roe,
    np_per_share: item.np_per_share,
    basic_eps: item.basic_eps,
    total_revenue: item.total_revenue,
    net_profit_atsopc: item.net_profit_atsopc,
    gross_selling_rate: item.gross_selling_rate,
    net_selling_rate: item.net_selling_rate,
    asset_liab_ratio: item.asset_liab_ratio,
    operate_cash_flow_ps: item.operate_cash_flow_ps,
  }
}

function trimSearchItem(item: R): R {
  return {
    code: item.code,
    name: item.name,
    current: item.current,
    exchange: item.exchange,
    percentage: item.percentage,
    indName: item.indName,
  }
}

// ── Operations ────────────────────────────────────────

const XUEQIU = 'https://xueqiu.com'
const STOCK = 'https://stock.xueqiu.com'

async function searchStocks(ctx: PreparedContext): Promise<unknown> {
  const { page, params, helpers } = ctx
  if (!page) throw helpers.errors.fatal('xueqiu adapter requires page')
  const url = `${XUEQIU}/query/v1/search/web/stock.json${qs({ q: params.q, count: params.count })}`
  const raw = await pageJson(page, url, helpers.errors)
  const list = (raw.list as R[]) ?? []
  return {
    count: raw.count,
    list: list.map(trimSearchItem),
    maxPage: raw.maxPage,
    page: raw.page,
  }
}

async function getStockQuote(ctx: PreparedContext): Promise<unknown> {
  const { page, params, helpers } = ctx
  if (!page) throw helpers.errors.fatal('xueqiu adapter requires page')
  const url = `${STOCK}/v5/stock/realtime/quotec.json${qs({ symbol: params.symbol })}`
  const raw = await pageJson(page, url, helpers.errors)
  const data = (raw.data as R[]) ?? []
  return { data: data.map(trimQuoteItem), error_code: raw.error_code }
}

async function getOrderBook(ctx: PreparedContext): Promise<unknown> {
  const { page, params, helpers } = ctx
  if (!page) throw helpers.errors.fatal('xueqiu adapter requires page')
  const url = `${STOCK}/v5/stock/realtime/pankou.json${qs({ symbol: params.symbol })}`
  const raw = await pageJson(page, url, helpers.errors)
  return { data: trimOrderBook(raw.data as R), error_code: raw.error_code }
}

async function getHotEvents(ctx: PreparedContext): Promise<unknown> {
  const { page, params, helpers } = ctx
  if (!page) throw helpers.errors.fatal('getHotEvents requires page transport')
  const url = `${XUEQIU}/hot_event/list.json${qs({ count: params.count })}`
  const raw = await pageJson(page, url, helpers.errors)
  const list = (raw.list as R[]) ?? []
  return {
    count: raw.count,
    list: list.map((item) => ({
      id: item.id,
      tag: item.tag,
      hot: item.hot,
      status_count: item.status_count,
      content: item.content,
    })),
  }
}

async function getTimeline(ctx: PreparedContext): Promise<unknown> {
  const { page, params, helpers } = ctx
  if (!page) throw helpers.errors.fatal('getTimeline requires page transport')
  const url = `${XUEQIU}/statuses/hot/listV2.json${qs({
    since_id: params.since_id,
    max_id: params.max_id,
    size: params.size,
  })}`
  const raw = await pageJson(page, url, helpers.errors)
  const items = (raw.items as R[]) ?? []
  return {
    next_max_id: raw.next_max_id,
    items: items.map((entry) => {
      const os = entry.original_status as R | undefined
      if (!os) return { id: entry.id }
      return { id: entry.id, original_status: trimPost(os) }
    }),
  }
}

async function getStockKline(ctx: PreparedContext): Promise<unknown> {
  const { page, params, helpers } = ctx
  if (!page) throw helpers.errors.fatal('getStockKline requires page transport')
  const url = `${STOCK}/v5/stock/chart/kline.json${qs({
    symbol: params.symbol,
    begin: params.begin,
    period: params.period,
    type: params.type,
    count: params.count,
    indicator: params.indicator,
  })}`
  const raw = await pageJson(page, url, helpers.errors)
  const data = raw.data as R
  const columns = (data?.column as string[]) ?? []
  const items = (data?.item as number[][]) ?? []
  const keepCols = ['timestamp', 'volume', 'open', 'high', 'low', 'close', 'chg', 'percent', 'turnoverrate', 'amount']
  const keepIdx = columns.map((c, i) => keepCols.includes(c) ? i : -1).filter((i) => i >= 0)
  return {
    data: {
      symbol: data?.symbol,
      column: keepIdx.map((i) => columns[i]),
      item: items.map((row) => keepIdx.map((i) => row[i])),
    },
    error_code: raw.error_code,
  }
}

async function getStockFinancials(ctx: PreparedContext): Promise<unknown> {
  const { page, params, helpers } = ctx
  if (!page) throw helpers.errors.fatal('getStockFinancials requires page transport')
  const url = `${STOCK}/v5/stock/finance/cn/indicator.json${qs({
    symbol: params.symbol,
    type: params.type,
    is_detail: params.is_detail,
    count: params.count,
    timestamp: params.timestamp,
  })}`
  const raw = await pageJson(page, url, helpers.errors)
  const data = raw.data as R
  const list = (data?.list as R[]) ?? []
  return {
    data: {
      symbol: data?.symbol,
      currency: data?.currency,
      list: list.map(trimFinancialItem),
    },
    error_code: raw.error_code,
  }
}

async function getStockComments(ctx: PreparedContext): Promise<unknown> {
  const { page, params, helpers } = ctx
  if (!page) throw helpers.errors.fatal('getStockComments requires page transport')
  const url = `${XUEQIU}/statuses/stock_timeline.json${qs({
    symbol: params.symbol,
    count: params.count,
    source: params.source,
    sort: params.sort,
    page: params.page,
  })}`
  const raw = await pageJson(page, url, helpers.errors)
  const list = (raw.list as R[]) ?? []
  return {
    count: raw.count,
    list: list.map(trimPost),
    maxPage: raw.maxPage,
    page: raw.page,
  }
}

async function getWatchlist(ctx: PreparedContext): Promise<unknown> {
  const { page, params, helpers } = ctx
  if (!page) throw helpers.errors.fatal('getWatchlist requires page transport')
  const url = `${STOCK}/v5/stock/portfolio/stock/list.json${qs({
    pid: params.pid,
    category: params.category,
    size: params.size,
  })}`
  const raw = await pageJson(page, url, helpers.errors)
  const data = raw.data as R
  const stocks = (data?.stocks as R[]) ?? []
  return {
    data: {
      pid: data?.pid,
      category: data?.category,
      stocks: stocks.map((s) => ({
        symbol: s.symbol,
        name: s.name,
        current: s.current,
        percent: s.percent,
        chg: s.chg,
        market_capital: s.market_capital,
      })),
    },
    error_code: raw.error_code,
  }
}

async function getIndustryStocks(ctx: PreparedContext): Promise<unknown> {
  const { page, params, helpers } = ctx
  if (!page) throw helpers.errors.fatal('getIndustryStocks requires page transport')
  const url = `${XUEQIU}/stock/industry/stockList.json${qs({
    code: params.code,
    type: params.type,
    size: params.size,
  })}`
  const raw = await pageJson(page, url, helpers.errors)
  const stocks = (raw.industrystocks as R[]) ?? []
  return {
    stockname: raw.stockname,
    platename: raw.platename,
    industryname: raw.industryname,
    code: raw.code,
    industrystocks: stocks.map((s) => ({
      symbol: s.symbol,
      code: s.code,
      name: s.name,
      exchange: s.exchange,
      current: s.current,
      percentage: s.percentage,
      change: s.change,
      volume: s.volume,
      pe_ttm: s.pe_ttm,
      marketCapital: s.marketCapital,
    })),
  }
}

// ── Adapter dispatch ──────────────────────────────────

type OpHandler = (ctx: PreparedContext) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  searchStocks,
  getStockQuote,
  getOrderBook,
  getHotEvents,
  getTimeline,
  getStockKline,
  getStockFinancials,
  getStockComments,
  getWatchlist,
  getIndustryStocks,
}

const adapter: CustomRunner = {
  name: 'xueqiu',
  description: 'Xueqiu (雪球) — response trimming and WAF bypass via page transport',

  async run(ctx) {
    const handler = OPERATIONS[ctx.operation]
    if (!handler) throw ctx.helpers.errors.unknownOp(ctx.operation)
    return handler(ctx)
  },
}

export default adapter
