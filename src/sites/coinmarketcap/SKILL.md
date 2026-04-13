# CoinMarketCap

## Overview
Cryptocurrency market data and rankings. Real-time prices, market caps, volumes, and trending tokens from CoinMarketCap's internal data API.

## Workflows

### Browse top cryptocurrencies
1. `getListings(limit)` -> ranked list with prices, market caps, volumes
2. `getQuote(id)` -> drill into a specific coin for full details

### Check a specific coin's market data
1. `getListings(sortBy: "name")` -> find coin -> note `id`
2. `getQuote(id)` -> price, market cap, supply, ATH/ATL, percent changes

### Discover trending coins
1. `getTrending(limit)` -> trending/most-searched coins
2. `getQuote(id)` -> details for a trending coin (use `cryptoId` from trending)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getListings | top coins by market cap | start, limit, sortBy | cryptoCurrencyList[].name, symbol, quotes[].price, marketCap, cmcRank | paginated, default sort: market_cap desc |
| getQuote | coin price/market data | id <- getListings | statistics.price, marketCap, volume24h, rank, ATH/ATL, description | numeric ID required (1=BTC, 1027=ETH) |
| getTrending | trending/hot coins | start, limit | list[].tokenName, tokenSymbol, priceUsd, volume24h, pricePercentageChange24h | entry point for discovery |

## Quick Start

```bash
# Get top 10 cryptocurrencies by market cap
openweb coinmarketcap exec getListings '{"limit":10}'

# Get Bitcoin details (id=1)
openweb coinmarketcap exec getQuote '{"id":1}'

# Get Ethereum details (id=1027)
openweb coinmarketcap exec getQuote '{"id":1027}'

# Get trending coins
openweb coinmarketcap exec getTrending '{"limit":10}'
```
