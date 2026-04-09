# CoinGecko

## Overview
Cryptocurrency data aggregator. Public REST API for searching coins, checking prices, market data, and trending tokens.

## Workflows

### Look up a coin's price and details
1. `searchCoins(query)` -> find coin -> note `id`
2. `getCoinDetail(id)` -> full details with market data, description, links

### Check current prices for multiple coins
1. `getPrice(ids, vs_currencies)` -> quick price lookup for known coin IDs

### Browse top coins by market cap
1. `getMarketData(vs_currency)` -> ranked list with prices, volumes, market caps
2. `getCoinDetail(id)` -> drill into a specific coin for full details

### Discover trending coins
1. `getTrending()` -> top trending coins by search volume
2. `getCoinDetail(id)` -> details for a trending coin

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchCoins | find coins by name/symbol | query | coins[].id, name, symbol, market_cap_rank | entry point for unknown coins |
| getCoinDetail | full coin details | id <- searchCoins | market_data.current_price, description, links, categories | use localization=false to reduce payload |
| getMarketData | ranked market overview | vs_currency | id, current_price, market_cap, total_volume, price_change_24h | paginated, entry point for top coins |
| getTrending | trending coins | -- | coins[].item.id, name, symbol, score | no params, entry point |
| getPrice | quick price check | ids, vs_currencies | {coin_id: {currency: price}} | fastest price lookup, batch multiple coins |

## Quick Start

```bash
# Search for a coin
openweb coingecko exec searchCoins '{"query":"bitcoin"}'

# Get detailed coin info
openweb coingecko exec getCoinDetail '{"id":"bitcoin","localization":false,"tickers":false,"community_data":false,"developer_data":false}'

# Get top 20 coins by market cap
openweb coingecko exec getMarketData '{"vs_currency":"usd","per_page":20}'

# Get trending coins
openweb coingecko exec getTrending '{}'

# Get prices for multiple coins
openweb coingecko exec getPrice '{"ids":"bitcoin,ethereum,solana","vs_currencies":"usd","include_24hr_change":true}'
```

---

## Site Internals

## API Architecture
Public REST API on `api.coingecko.com`. Versioned at `/api/v3/`. All responses are JSON. No GraphQL, no SSR.

## Auth
No auth required. Free tier has rate limits (10-30 calls/minute). Pro API uses a different base URL with API key header.

## Transport
`node` -- direct HTTP. No bot detection, no browser needed. Public JSON API.

## Known Issues
- Free tier rate limit: 10-30 calls/minute. Avoid rapid consecutive calls.
- `getCoinDetail` returns large payloads by default. Use `localization=false`, `tickers=false`, `community_data=false`, `developer_data=false` to reduce size.
- Coin IDs are lowercase slugs (e.g., `bitcoin`, `ethereum`, `solana`), not ticker symbols.
- `getPrice` response is dynamically keyed by coin ID -- not a fixed schema.
- Market data prices can be null for very new or delisted coins.
