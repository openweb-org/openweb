# Robinhood

## Overview
Stock trading platform — market data archetype. Stock quotes, crypto prices, fundamentals, analyst ratings, earnings, historicals, market movers, and curated collections via Robinhood's internal APIs.

## Workflows

### Stock Research
1. `getInstruments(ids)` → `results[].id`, `results[].url` (instrument URL)
2. `getStockQuotes(instruments=url)` → real-time price, bid, ask
3. `getStockFundamentals(instrument_id=id)` → market cap, PE, sector
4. `getAnalystRatings(instrument_id=id)` → buy/hold/sell consensus
5. `getStockEarnings(instrument=url)` → EPS history
6. `getStockNews(instrument_id=id)` → recent articles

### Stock Charting
1. `getInstruments(ids)` → `results[].id`
2. `getStockHistoricals(instrument_id=id, interval, span)` → OHLCV candles

### Crypto Research
1. `getCryptoQuote(pair_id)` → real-time price
2. `getCryptoFundamentals(pair_id)` → market cap, supply
3. `getCryptoHistoricals(pair_id, interval, span)` → OHLCV candles

### Market Discovery
1. `getMarketMovers(direction)` → `results[].instrument_url`, `results[].symbol`
2. `getTagCollection(slug)` → `instruments[]` (full URLs — extract UUIDs)
3. `getInstruments(ids ← UUIDs from instruments[])` → resolve to symbols, `results[].id`
4. `getDiscoveryLists(object_id=id, object_type, owner_type)` → curated lists

## Operations
| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getInstruments | resolve UUIDs to stock symbols | `ids` (comma-sep UUIDs) | symbol, name, tradability, market | entry point — provides instrument URLs for quotes/earnings |
| getStockQuotes | real-time stock prices | `instruments` (← instrument URLs from getInstruments) | last_trade_price, bid, ask, previous_close | accepts full instrument URLs, not bare UUIDs |
| getStockFundamentals | company fundamentals | `instrument_id` (← id from getInstruments) | market_cap, pe_ratio, dividend_yield, sector, ceo | includes 52-week range and volume averages |
| getStockHistoricals | stock OHLCV chart data | `instrument_id` ← getInstruments, `interval`, `span` | historicals[].open/close/high/low/volume | bounds: regular, extended, trading |
| getStockEarnings | earnings history | `instrument` ← getInstruments (full URL) | eps.estimate, eps.actual, report.date | eps.actual and call nullable for future quarters |
| getAnalystRatings | analyst consensus | `instrument_id` (← id) | summary.num_buy/hold/sell_ratings, ratings[] | individual ratings have type + text |
| getStockNews | stock news feed | `instrument_id` (← id) | title, source, date, preview_text | served from dora.robinhood.com |
| getCryptoQuote | crypto real-time price | `pair_id` | bid, ask, mark, open, high, low, volume | BTC: 3d961844-..., ETH: 76637d50-... |
| getCryptoFundamentals | crypto fundamentals | `pair_id` | market_cap, circulating_supply, 52-week range | |
| getCryptoHistoricals | crypto OHLCV chart data | `pair_id`, `interval`, `span` | data_points[].open/close/high/low/volume | bounds default: 24_7 |
| getMarketHours | exchange schedule | `mic`, `date` | is_open, opens_at, closes_at, extended hours | MIC codes: XNYS, XNAS, XASE |
| getDiscoveryLists | curated lists for instrument | `object_id` ← getInstruments, `object_type`, `owner_type` | display_name, item_count | object_type typically "instrument" |
| getMarketMovers | S&P 500 top movers | `direction` (up/down) | symbol, price_movement.pct, last_price | returns top 10 gainers or losers |
| getTagCollection | tagged stock collection | `slug` (e.g. "100-most-popular") | instruments[] (full URLs), name, membership_count | extract UUIDs from URLs for getInstruments |

## Quick Start
```bash
# Look up Apple by instrument UUID
openweb robinhood exec getInstruments '{"ids": "450dfc6d-5510-4d40-abfb-f633b7d9be3e"}'

# Get real-time quote
openweb robinhood exec getStockQuotes '{"instruments": "https://api.robinhood.com/instruments/450dfc6d-5510-4d40-abfb-f633b7d9be3e/"}'

# Stock chart data (daily, 1 week)
openweb robinhood exec getStockHistoricals '{"instrument_id": "450dfc6d-5510-4d40-abfb-f633b7d9be3e", "interval": "day", "span": "week"}'

# Analyst ratings
openweb robinhood exec getAnalystRatings '{"instrument_id": "450dfc6d-5510-4d40-abfb-f633b7d9be3e"}'

# BTC price
openweb robinhood exec getCryptoQuote '{"pair_id": "3d961844-d360-45fc-989b-f6fca761d511"}'

# Today's top S&P 500 gainers
openweb robinhood exec getMarketMovers '{"direction": "up"}'

# 100 most popular stocks
openweb robinhood exec getTagCollection '{"slug": "100-most-popular"}'
```
