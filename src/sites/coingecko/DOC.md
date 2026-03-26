# CoinGecko

## Overview
CoinGecko crypto market data API — free, no auth required.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getPrice | current price of coins | GET /api/v3/simple/price | comma-separated `ids` + `vs_currencies` |
| searchCoins | search coins/exchanges | GET /api/v3/search | also returns exchanges, categories, nfts |
| getCoinMarkets | coins by market cap | GET /api/v3/coins/markets | page-based pagination |
| getCoinDetail | full info for a coin | GET /api/v3/coins/{id} | description, links, market data, categories |
| getCoinMarketChart | historical price chart | GET /api/v3/coins/{id}/market_chart | prices, market caps, volumes over time |
| getTrendingCoins | trending coins (24h) | GET /api/v3/search/trending | no params, returns top trending |
| getGlobalData | global market stats | GET /api/v3/global | total market cap, volume, BTC dominance |
| getExchanges | exchange rankings | GET /api/v3/exchanges | paginated, ranked by volume |

## API Architecture
- REST v3 at `api.coingecko.com/api/v3/`
- `getPrice` response is dynamic-keyed: `{bitcoin: {usd: 64000}}` — keys match input params
- `getCoinMarkets` and `getExchanges` use `per_page` + `page` params
- `getCoinMarketChart` returns arrays of `[timestamp, value]` pairs
- `getCoinDetail` response is large (~30KB) — use boolean params to trim sections
- `getTrendingCoins` wraps each coin in `{item: {...}}` — extra nesting

## Transport
- `node` — direct HTTP, no browser needed

## Known Issues
- Aggressive rate limiting on free tier (~10-30 req/min) — `getPrice` most affected
- Website is SSR (Rails) — no client-side API calls to api.coingecko.com, so CDP capture doesn't discover API endpoints
