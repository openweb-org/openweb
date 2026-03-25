/**
 * Xueqiu L3 adapter — REST API via browser fetch.
 *
 * Xueqiu serves stock data through REST endpoints on stock.xueqiu.com
 * and social/search data on xueqiu.com. All requests require browser
 * cookies (xq_a_token) set on first visit — direct HTTP is blocked.
 */
import type { CodeAdapter } from '../../../types/adapter.js'
import type { Page } from 'playwright-core'

/* ---------- constants ---------- */

const STOCK_API = 'https://stock.xueqiu.com'
const MAIN_API = 'https://xueqiu.com'

/* ---------- helpers ---------- */

async function apiFetch(page: Page, url: string, label: string): Promise<unknown> {
  const result = await page.evaluate(
    async (args: { url: string }) => {
      const resp = await fetch(args.url, { credentials: 'include' })
      return { status: resp.status, text: await resp.text() }
    },
    { url },
  )

  if (result.status >= 400) {
    throw new Error(`Xueqiu ${label}: HTTP ${result.status}`)
  }

  return JSON.parse(result.text)
}

/* ---------- operation handlers ---------- */

async function getStockQuote(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const symbol = String(params.symbol ?? '')
  const url = `${STOCK_API}/v5/stock/quote.json?symbol=${encodeURIComponent(symbol)}&extend=detail`
  return apiFetch(page, url, 'getStockQuote')
}

async function getMarketIndices(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const symbols = String(params.symbols ?? 'SH000001,SZ399001,SZ399006,SH000300,SH000016,SH000905')
  const url = `${STOCK_API}/v5/stock/batch/quote.json?symbol=${encodeURIComponent(symbols)}`
  return apiFetch(page, url, 'getMarketIndices')
}

async function getKlineChart(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const symbol = String(params.symbol ?? '')
  const period = String(params.period ?? 'day')
  const count = Number(params.count ?? -30)
  const begin = params.begin ? Number(params.begin) : Date.now()
  const url = `${STOCK_API}/v5/stock/chart/kline.json?symbol=${encodeURIComponent(symbol)}&begin=${String(begin)}&period=${period}&type=before&count=${String(count)}`
  return apiFetch(page, url, 'getKlineChart')
}

async function suggestStock(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? params.q ?? '')
  const url = `${MAIN_API}/query/v1/suggest_stock.json?q=${encodeURIComponent(query)}`
  return apiFetch(page, url, 'suggestStock')
}

async function getHotPosts(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const size = Number(params.size ?? 10)
  const maxId = params.max_id !== undefined ? Number(params.max_id) : -1
  const url = `${MAIN_API}/statuses/hot/listV2.json?since_id=-1&max_id=${String(maxId)}&size=${String(size)}`
  return apiFetch(page, url, 'getHotPosts')
}

async function searchPosts(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? params.q ?? '')
  const count = Number(params.count ?? 10)
  const pageNum = Number(params.page ?? 1)
  const sort = String(params.sort ?? '')
  const url = `${MAIN_API}/query/v1/search/status.json?q=${encodeURIComponent(query)}&count=${String(count)}&comment=0&symbol=&hl=true&source=all&sort=${sort}&page=${String(pageNum)}`
  return apiFetch(page, url, 'searchPosts')
}

async function searchUsers(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const query = String(params.query ?? params.q ?? '')
  const count = Number(params.count ?? 10)
  const pageNum = Number(params.page ?? 1)
  const url = `${MAIN_API}/query/v1/search/user.json?q=${encodeURIComponent(query)}&count=${String(count)}&page=${String(pageNum)}`
  return apiFetch(page, url, 'searchUsers')
}

async function getFinancialIncome(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const symbol = String(params.symbol ?? '')
  const count = Number(params.count ?? 5)
  const url = `${STOCK_API}/v5/stock/finance/cn/income.json?symbol=${encodeURIComponent(symbol)}&type=all&is_detail=true&count=${String(count)}`
  return apiFetch(page, url, 'getFinancialIncome')
}

async function getFinancialIndicators(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const symbol = String(params.symbol ?? '')
  const count = Number(params.count ?? 5)
  const url = `${STOCK_API}/v5/stock/finance/cn/indicator.json?symbol=${encodeURIComponent(symbol)}&type=all&is_detail=true&count=${String(count)}`
  return apiFetch(page, url, 'getFinancialIndicators')
}

async function getStockScreener(page: Page, params: Record<string, unknown>): Promise<unknown> {
  const pageNum = Number(params.page ?? 1)
  const size = Number(params.size ?? 10)
  const orderBy = String(params.order_by ?? 'percent')
  const order = String(params.order ?? 'desc')
  const market = String(params.market ?? 'CN')
  const type = String(params.type ?? 'sh_sz')
  const url = `${MAIN_API}/service/v5/stock/screener/quote/list?page=${String(pageNum)}&size=${String(size)}&order=${order}&orderby=${orderBy}&order_by=${orderBy}&market=${market}&type=${type}`
  return apiFetch(page, url, 'getStockScreener')
}

/* ---------- adapter export ---------- */

const OPERATIONS: Record<string, (page: Page, params: Record<string, unknown>) => Promise<unknown>> = {
  getStockQuote,
  getMarketIndices,
  getKlineChart,
  suggestStock,
  getHotPosts,
  searchPosts,
  searchUsers,
  getFinancialIncome,
  getFinancialIndicators,
  getStockScreener,
}

const adapter: CodeAdapter = {
  name: 'xueqiu-api',
  description: 'Xueqiu REST API — stock quotes, charts, financials, social posts, search',

  async init(page: Page): Promise<boolean> {
    return page.url().includes('xueqiu.com')
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    const cookies = await page.context().cookies('https://xueqiu.com')
    return cookies.some((c) => c.name === 'xq_a_token')
  },

  async execute(page: Page, operation: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const handler = OPERATIONS[operation]
    if (!handler) {
      throw new Error(`Unknown operation: ${operation}`)
    }
    return handler(page, { ...params })
  },
}

export default adapter
