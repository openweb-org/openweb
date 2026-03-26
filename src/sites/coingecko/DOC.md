# CoinGecko

## Overview
CoinGecko crypto market data API — free, no auth required.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getPrice | current price of coins | GET /api/v3/simple/price | comma-separated `ids` + `vs_currencies` |
| searchCoins | search coins/exchanges | GET /api/v3/search | also returns exchanges, categories, nfts |
| getCoinMarkets | coins by market cap | GET /api/v3/coins/markets | page-based pagination |

## API Architecture
- REST v3 at `api.coingecko.com/api/v3/`
- `getPrice` response is dynamic-keyed: `{bitcoin: {usd: 64000}}` — keys match input params
- `getCoinMarkets` uses `per_page` + `page` params (not link_header)

## Transport
- `node` — direct HTTP, no browser needed
