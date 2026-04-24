import { nodeFetch } from '../../../lib/adapter-helpers.js'
import type { CustomRunner, AdapterErrorHelpers } from '../../../types/adapter.js'

const BASE = 'https://api.coinmarketcap.com'

type Params = Readonly<Record<string, unknown>>
type Errors = AdapterErrorHelpers
type R = Record<string, unknown>

async function fetchJson(url: string, errors: Errors): Promise<R> {
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

// ── Trim helpers ───────────────────────────────────────

function trimQuote(q: R): R {
  return {
    name: q.name,
    price: q.price ?? null,
    volume24h: q.volume24h ?? null,
    marketCap: q.marketCap ?? null,
    percentChange1h: q.percentChange1h ?? null,
    percentChange24h: q.percentChange24h ?? null,
    percentChange7d: q.percentChange7d ?? null,
    percentChange30d: q.percentChange30d ?? null,
  }
}

function trimListingItem(item: R): R {
  const quotes = item.quotes as R[] | undefined
  return {
    id: item.id,
    name: item.name,
    symbol: item.symbol,
    slug: item.slug,
    cmcRank: item.cmcRank,
    circulatingSupply: item.circulatingSupply ?? null,
    totalSupply: item.totalSupply ?? null,
    maxSupply: item.maxSupply ?? null,
    lastUpdated: item.lastUpdated,
    dateAdded: item.dateAdded,
    quotes: (quotes ?? []).map(trimQuote),
  }
}

function trimStatistics(s: R): R {
  return {
    price: s.price ?? null,
    priceChangePercentage1h: s.priceChangePercentage1h ?? null,
    priceChangePercentage24h: s.priceChangePercentage24h ?? null,
    priceChangePercentage7d: s.priceChangePercentage7d ?? null,
    priceChangePercentage30d: s.priceChangePercentage30d ?? null,
    marketCap: s.marketCap ?? null,
    fullyDilutedMarketCap: s.fullyDilutedMarketCap ?? null,
    circulatingSupply: s.circulatingSupply ?? null,
    totalSupply: s.totalSupply ?? null,
    maxSupply: s.maxSupply ?? null,
    marketCapDominance: s.marketCapDominance ?? null,
    rank: s.rank ?? null,
    volume24h: s.volume24h ?? null,
    high24h: s.high24h ?? null,
    low24h: s.low24h ?? null,
    highAllTime: s.highAllTime ?? null,
    lowAllTime: s.lowAllTime ?? null,
    highAllTimeTimestamp: s.highAllTimeTimestamp ?? null,
    lowAllTimeTimestamp: s.lowAllTimeTimestamp ?? null,
  }
}

function trimUrls(u: R): R {
  return {
    website: u.website ?? [],
    technical_doc: u.technical_doc ?? [],
    explorer: u.explorer ?? [],
    source_code: u.source_code ?? [],
    reddit: u.reddit ?? [],
    twitter: u.twitter ?? [],
  }
}

function trimDetail(data: R): R {
  const stats = data.statistics as R | undefined
  const urls = data.urls as R | undefined
  const desc = String(data.description ?? '')
  return {
    id: data.id,
    name: data.name,
    symbol: data.symbol,
    slug: data.slug,
    category: data.category,
    description: desc.length > 2000 ? `${desc.slice(0, 2000)}…` : desc,
    dateAdded: data.dateAdded,
    urls: urls ? trimUrls(urls) : {},
    statistics: stats ? trimStatistics(stats) : {},
    volume: data.volume ?? null,
    volumeChangePercentage24h: data.volumeChangePercentage24h ?? null,
  }
}

function trimTrendingItem(item: R): R {
  return {
    cryptoId: item.cryptoId,
    slug: item.slug,
    tokenSymbol: item.tokenSymbol,
    tokenName: item.tokenName,
    priceUsd: item.priceUsd,
    volume24h: item.volume24h,
    pricePercentageChange24h: item.pricePercentageChange24h,
    marketCap: item.marketCap,
  }
}

// ── Operations ─────────────────────────────────────────

async function getListings(params: Params, errors: Errors): Promise<unknown> {
  const raw = await fetchJson(
    `${BASE}/data-api/v3/cryptocurrency/listing${qs({
      start: params.start,
      limit: params.limit,
      sortBy: params.sortBy,
      sortType: params.sortType,
      convert: params.convert,
      cryptoType: params.cryptoType,
    })}`,
    errors,
  )
  const data = raw.data as R
  const list = (data?.cryptoCurrencyList as R[]) ?? []
  return {
    data: {
      cryptoCurrencyList: list.map(trimListingItem),
      totalCount: data?.totalCount,
    },
    status: raw.status,
  }
}

async function getQuote(params: Params, errors: Errors): Promise<unknown> {
  if (!params.slug && !params.id) throw errors.missingParam('slug')
  const raw = await fetchJson(
    `${BASE}/data-api/v3/cryptocurrency/detail${qs({
      id: params.id,
      slug: params.slug,
      dataType: params.dataType,
    })}`,
    errors,
  )
  const data = raw.data as R | undefined
  return {
    data: data ? trimDetail(data) : null,
    status: raw.status,
  }
}

async function getTrending(params: Params, errors: Errors): Promise<unknown> {
  const raw = await fetchJson(
    `${BASE}/data-api/v3/unified-trending/top-boost/listing${qs({
      start: params.start,
      limit: params.limit,
    })}`,
    errors,
  )
  const data = raw.data as R
  const list = (data?.list as R[]) ?? []
  return {
    data: { list: list.map(trimTrendingItem) },
    status: raw.status,
  }
}

// ── Adapter ────────────────────────────────────────────

type OpHandler = (params: Params, errors: Errors) => Promise<unknown>

const OPERATIONS: Record<string, OpHandler> = {
  getListings,
  getQuote,
  getTrending,
}

const adapter: CustomRunner = {
  name: 'coinmarketcap',
  description: 'CoinMarketCap — response trimming for all 3 read ops',

  async run(ctx) {
    const { operation, params, helpers } = ctx
    const handler = OPERATIONS[operation]
    if (!handler) throw helpers.errors.unknownOp(operation)
    return handler(params, helpers.errors)
  },
}

export default adapter
