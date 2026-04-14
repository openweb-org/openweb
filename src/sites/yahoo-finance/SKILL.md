# Yahoo Finance

## Overview
Financial data portal. Stock quotes, charts, financials, market screeners, analyst ratings, and company insights via Yahoo Finance internal APIs.

## Workflows

### Look up a stock and get current price + chart
1. `searchTickers(q)` → `quotes[].symbol`
2. `getChart(symbol ← searchTickers, range)` → OHLCV price history + `meta.regularMarketPrice`

### Compare multiple stocks quickly
1. `getSparkline(symbols)` → mini price charts for multiple symbols at once (comma-separated)

### Screen market movers and drill into a pick
1. `getScreener(scrIds)` → top gainers/losers/most active → pick `quotes[].symbol`
2. `getChart(symbol ← getScreener)` → price history
3. `getInsights(symbols ← getScreener)` → technicals, valuation, analyst recommendation

### Research a company fundamentals
1. `searchTickers(q)` → `quotes[].symbol`
2. `getTimeSeries(symbol ← searchTickers, type, period1, period2)` → revenue, net income, EPS over time
3. `getRatings(symbol ← searchTickers)` → analyst ratings and price targets
4. `getInsights(symbols ← searchTickers)` → valuation, company snapshot, SEC filings

### Check upcoming market events
1. `getCalendarEvents()` → IPOs, earnings, splits by date → pick `ticker`
2. `getQuoteType(symbol ← ticker)` → classify a symbol (equity, ETF, index, crypto)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchTickers | search stocks by keyword | `q` | symbol, shortname, quoteType, exchange; news[] | entry point |
| getChart | historical OHLCV prices | `symbol` ← searchTickers, `range` or `period1`/`period2` | meta.regularMarketPrice, timestamp[], open/high/low/close/volume arrays | |
| getSparkline | quick multi-symbol price snapshot | `symbols` (comma-sep) | regularMarketPrice, previousClose, close[] | entry point (symbols known) |
| getScreener | market movers list | `scrIds` ("most_actives" / "day_gainers" / "day_losers") | quotes[].symbol, shortName, price.raw, change.raw, volume.raw | entry point; results change each call |
| getRatings | analyst ratings | `symbol` ← searchTickers | analyst, rating_current, pt_current per category (dir/mm/pt/fin_score) | nullable fields when no active rating |
| getInsights | company insights + technicals | `symbols` ← searchTickers | technicalEvents outlooks, keyTechnicals, valuation, recommendation, secReports | |
| getTimeSeries | financial fundamentals over time | `symbol` ← searchTickers, `type` (metric names), `period1`, `period2` | metric values with reportedValue.raw + timestamps | requires Unix timestamps |
| getCalendarEvents | upcoming market events | -- | ipoEvents[], earnings[], splits[] with ticker, companyShortName, date | entry point |
| getQuoteType | symbol classification | `symbol` ← searchTickers | quoteType, exchange, shortName, market | |

## Quick Start

```bash
# Search for a ticker
openweb yahoo-finance exec searchTickers '{"q": "AAPL"}'

# Get 1-month price chart
openweb yahoo-finance exec getChart '{"symbol": "AAPL", "range": "1mo"}'

# Quick price snapshot for multiple symbols
openweb yahoo-finance exec getSparkline '{"symbols": "AAPL,MSFT,GOOGL"}'

# Top market movers (most active)
openweb yahoo-finance exec getScreener '{"scrIds": "most_actives"}'

# Analyst ratings
openweb yahoo-finance exec getRatings '{"symbol": "AAPL"}'

# Company insights and technicals
openweb yahoo-finance exec getInsights '{"symbols": "AAPL"}'

# Revenue and earnings history (last 5 years)
openweb yahoo-finance exec getTimeSeries '{"symbol": "AAPL", "type": "annualTotalRevenue,annualNetIncome,annualBasicEPS", "period1": 1585699200, "period2": 1743465600}'

# Upcoming IPOs, earnings, splits
openweb yahoo-finance exec getCalendarEvents '{}'

# Check what type a symbol is
openweb yahoo-finance exec getQuoteType '{"symbol": "AAPL"}'
```
