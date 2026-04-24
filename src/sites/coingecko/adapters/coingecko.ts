import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const BASE = 'https://api.coingecko.com'

type Params = Readonly<Record<string, unknown>>
type Errors = AdapterErrorHelpers
type R = Record<string, unknown>

async function fetchJson(url: string, errors: Errors): Promise<unknown> {
  const { status, text } = await nodeFetch({ url, method: 'GET', timeout: 20_000 })
  if (status < 200 || status >= 300) throw errors.httpError(status)
  return JSON.parse(text)
}

function qs(params: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      parts.push(`${k}=${encodeURIComponent(String(v))}`)
    }
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

function usdOnly(dict: unknown): R | null {
  if (!dict || typeof dict !== 'object') return null
  const d = dict as R
  return { usd: d.usd ?? null }
}

// ── Trim helpers ───────────────────────────────────────

function trimSearchCoin(c: R): R {
  return {
    id: c.id,
    name: c.name,
    symbol: c.symbol,
    market_cap_rank: c.market_cap_rank ?? null,
    thumb: c.thumb ?? null,
  }
}

function trimMarketData(md: R): R {
  return {
    current_price: usdOnly(md.current_price),
    market_cap: usdOnly(md.market_cap),
    total_volume: usdOnly(md.total_volume),
    high_24h: usdOnly(md.high_24h),
    low_24h: usdOnly(md.low_24h),
    ath: usdOnly(md.ath),
    atl: usdOnly(md.atl),
    price_change_24h: md.price_change_24h ?? null,
    price_change_percentage_24h: md.price_change_percentage_24h ?? null,
    price_change_percentage_7d: md.price_change_percentage_7d ?? null,
    price_change_percentage_30d: md.price_change_percentage_30d ?? null,
    price_change_percentage_1y: md.price_change_percentage_1y ?? null,
    market_cap_change_24h: md.market_cap_change_24h ?? null,
    market_cap_change_percentage_24h: md.market_cap_change_percentage_24h ?? null,
    circulating_supply: md.circulating_supply ?? null,
    total_supply: md.total_supply ?? null,
    max_supply: md.max_supply ?? null,
    last_updated: md.last_updated ?? null,
  }
}

function trimLinks(links: R): R {
  const homepage = links.homepage as string[] | undefined
  const blockchain = links.blockchain_site as string[] | undefined
  const repos = links.repos_url as R | undefined
  return {
    homepage: (homepage ?? []).filter(Boolean).slice(0, 3),
    whitepaper: links.whitepaper ?? null,
    blockchain_site: (blockchain ?? []).filter(Boolean).slice(0, 3),
    subreddit_url: links.subreddit_url ?? null,
    repos_url: { github: ((repos?.github as string[]) ?? []).filter(Boolean).slice(0, 3) },
  }
}

function trimCoinDetail(data: R): R {
  const desc = data.description as R | undefined
  const enDesc = String(desc?.en ?? '')
  const md = data.market_data as R | undefined
  const links = data.links as R | undefined
  return {
    id: data.id,
    symbol: data.symbol,
    name: data.name,
    web_slug: data.web_slug ?? null,
    hashing_algorithm: data.hashing_algorithm ?? null,
    categories: data.categories ?? [],
    description: enDesc.length > 2000 ? `${enDesc.slice(0, 2000)}…` : enDesc,
    links: links ? trimLinks(links) : {},
    image: data.image ?? {},
    genesis_date: data.genesis_date ?? null,
    sentiment_votes_up_percentage: data.sentiment_votes_up_percentage ?? null,
    sentiment_votes_down_percentage: data.sentiment_votes_down_percentage ?? null,
    market_cap_rank: data.market_cap_rank ?? null,
    market_data: md ? trimMarketData(md) : null,
    community_data: data.community_data ?? null,
    developer_data: data.developer_data ?? null,
    last_updated: data.last_updated ?? null,
  }
}

function trimTrendingCoin(item: R): R {
  const data = item.data as R | undefined
  const pct = data?.price_change_percentage_24h as R | undefined
  return {
    id: item.id,
    coin_id: item.coin_id,
    name: item.name,
    symbol: item.symbol,
    market_cap_rank: item.market_cap_rank ?? null,
    thumb: item.thumb ?? null,
    slug: item.slug ?? null,
    price_btc: item.price_btc ?? null,
    score: item.score,
    data: data
      ? {
          price: data.price ?? null,
          price_btc: data.price_btc ?? null,
          price_change_percentage_24h: pct?.usd ?? null,
          market_cap: data.market_cap ?? null,
          total_volume: data.total_volume ?? null,
        }
      : null,
  }
}

function trimTrendingCategory(cat: R): R {
  const data = cat.data as R | undefined
  const pct = data?.market_cap_change_percentage_24h as R | undefined
  return {
    id: cat.id,
    name: cat.name,
    market_cap_1h_change: cat.market_cap_1h_change ?? null,
    coins_count: cat.coins_count ?? null,
    data: data
      ? {
          market_cap: data.market_cap ?? null,
          total_volume: data.total_volume ?? null,
          market_cap_change_percentage_24h: pct?.usd ?? null,
        }
      : null,
  }
}

function trimTrendingNft(nft: R): R {
  return {
    id: nft.id,
    name: nft.name,
    symbol: nft.symbol,
    thumb: nft.thumb ?? null,
    floor_price_in_native_currency: nft.floor_price_in_native_currency ?? null,
    floor_price_24h_percentage_change: nft.floor_price_24h_percentage_change ?? null,
  }
}

function trimMarketItem(item: R): R {
  return {
    id: item.id,
    symbol: item.symbol,
    name: item.name,
    image: item.image ?? null,
    current_price: item.current_price ?? null,
    market_cap: item.market_cap ?? null,
    market_cap_rank: item.market_cap_rank ?? null,
    total_volume: item.total_volume ?? null,
    high_24h: item.high_24h ?? null,
    low_24h: item.low_24h ?? null,
    price_change_24h: item.price_change_24h ?? null,
    price_change_percentage_24h: item.price_change_percentage_24h ?? null,
    circulating_supply: item.circulating_supply ?? null,
    total_supply: item.total_supply ?? null,
    max_supply: item.max_supply ?? null,
    ath: item.ath ?? null,
    atl: item.atl ?? null,
    last_updated: item.last_updated ?? null,
  }
}

// ── Operations ─────────────────────────────────────────

async function searchCoins(params: Params, errors: Errors): Promise<unknown> {
  if (!params.query) throw errors.missingParam('query')
  const raw = (await fetchJson(`${BASE}/api/v3/search${qs({ query: params.query })}`, errors)) as R
  const coins = (raw.coins as R[]) ?? []
  const nfts = (raw.nfts as R[]) ?? []
  return {
    coins: coins.slice(0, 15).map(trimSearchCoin),
    exchanges: raw.exchanges ?? [],
    categories: raw.categories ?? [],
    nfts: nfts.slice(0, 10).map((n: R) => ({ id: n.id, name: n.name, symbol: n.symbol, thumb: n.thumb ?? null })),
  }
}

async function getCoinDetail(params: Params, errors: Errors): Promise<unknown> {
  if (!params.id) throw errors.missingParam('id')
  const raw = (await fetchJson(
    `${BASE}/api/v3/coins/${encodeURIComponent(String(params.id))}${qs({
      localization: false,
      tickers: false,
      sparkline: params.sparkline ?? false,
      community_data: params.community_data ?? false,
      developer_data: params.developer_data ?? false,
    })}`,
    errors,
  )) as R
  return trimCoinDetail(raw)
}

async function getMarketData(params: Params, errors: Errors): Promise<unknown> {
  if (!params.vs_currency) throw errors.missingParam('vs_currency')
  const raw = (await fetchJson(
    `${BASE}/api/v3/coins/markets${qs({
      vs_currency: params.vs_currency,
      ids: params.ids,
      order: params.order,
      per_page: params.per_page ?? 25,
      page: params.page,
      sparkline: params.sparkline ?? false,
      price_change_percentage: params.price_change_percentage,
    })}`,
    errors,
  )) as R[]
  return raw.map(trimMarketItem)
}

async function getTrending(_params: Params, errors: Errors): Promise<unknown> {
  const raw = (await fetchJson(`${BASE}/api/v3/search/trending`, errors)) as R
  const coins = (raw.coins as R[]) ?? []
  const nfts = (raw.nfts as R[]) ?? []
  const categories = (raw.categories as R[]) ?? []
  return {
    coins: coins.map((c: R) => ({ item: trimTrendingCoin((c as R).item as R) })),
    nfts: nfts.map(trimTrendingNft),
    categories: categories.map(trimTrendingCategory),
  }
}

async function getPrice(params: Params, errors: Errors): Promise<unknown> {
  if (!params.ids) throw errors.missingParam('ids')
  if (!params.vs_currencies) throw errors.missingParam('vs_currencies')
  return fetchJson(
    `${BASE}/api/v3/simple/price${qs({
      ids: params.ids,
      vs_currencies: params.vs_currencies,
      include_market_cap: params.include_market_cap,
      include_24hr_vol: params.include_24hr_vol,
      include_24hr_change: params.include_24hr_change,
      include_last_updated_at: params.include_last_updated_at,
    })}`,
    errors,
  )
}

// ── Adapter ────────────────────────────────────────────

type OpHandler = (params: Params, errors: Errors) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  searchCoins,
  getCoinDetail,
  getMarketData,
  getTrending,
  getPrice,
}

const adapter: CustomRunner = {
  name: 'coingecko',
  description: 'CoinGecko — response trimming for all 5 read ops',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
