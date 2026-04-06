# Yahoo Finance

## Overview
Financial data portal. Stock quotes, charts, financials, market screeners, analyst ratings, and company insights via Yahoo Finance internal APIs.

## Workflows

### Look up a stock and get current price + chart
1. `searchTickers(q)` → match symbol → `symbol`
2. `getChart(symbol, range)` → OHLCV price history + current price in `meta.regularMarketPrice`

### Compare multiple stocks quickly
1. `getSparkline(symbols)` → mini price charts for multiple symbols at once (comma-separated)

### Screen market movers and drill into a pick
1. `getScreener(scrIds)` → top gainers/losers/most active → pick `symbol`
2. `getChart(symbol)` → price history
3. `getInsights(symbols)` → technicals, valuation, analyst recommendation

### Research a company fundamentals
1. `searchTickers(q)` → `symbol`
2. `getTimeSeries(symbol, type, period1, period2)` → revenue, net income, EPS over time
3. `getRatings(symbol)` → analyst ratings and price targets
4. `getInsights(symbols)` → valuation, company snapshot, SEC filings

### Check upcoming market events
1. `getCalendarEvents()` → IPOs, earnings, splits by date
2. `getQuoteType(symbol)` → classify a symbol (equity, ETF, index, crypto)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchTickers | search stocks by keyword | q | symbol, shortname, quoteType, exchange; news[] | entry point |
| getChart | historical OHLCV prices | symbol, range or period1/period2 | meta.regularMarketPrice, timestamp[], open/high/low/close/volume arrays | |
| getSparkline | quick multi-symbol price snapshot | symbols (comma-sep) | regularMarketPrice, previousClose, close[] | |
| getScreener | market movers list | scrIds ← "most_actives" / "day_gainers" / "day_losers" | symbol, shortName, price.raw, change.raw, volume.raw | results change each call (dynamic) |
| getRatings | analyst ratings | symbol ← searchTickers | analyst, rating_current, pt_current per category (dir/mm/pt/fin_score) | nullable fields when no active rating |
| getInsights | company insights + technicals | symbols ← searchTickers | technicalEvents outlooks, keyTechnicals, valuation, recommendation, secReports | |
| getTimeSeries | financial fundamentals over time | symbol ← searchTickers, type (metric names), period1, period2 | metric values with reportedValue.raw + timestamps | requires Unix timestamps |
| getCalendarEvents | upcoming market events | — | ipoEvents[], earnings[], splits[] with ticker, companyShortName, date | entry point |
| getQuoteType | symbol classification | symbol ← searchTickers | quoteType, exchange, shortName, market | |

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

---

## Site Internals

## API Architecture
- **Two API hosts**: `query1.finance.yahoo.com` and `query2.finance.yahoo.com` — both serve data, some endpoints are on one or the other
- Internal APIs used by the finance.yahoo.com frontend — no official documentation
- Most read endpoints are public (no auth required)
- **v7/finance/quote requires crumb** — session-specific CSRF token obtained from Yahoo's consent flow. Not included — use getSparkline or getChart for current price data instead
- v10/finance/quoteSummary also requires crumb

## Auth
No auth required. All 9 operations work without authentication.

## Transport
- `transport: node` — direct HTTP fetch from Node.js
- No bot detection on the API endpoints (query1/query2 subdomains)

## Extraction
All operations return JSON directly — no SSR extraction needed.

## Known Issues
- **Null values in chart data** — current trading day may have null close/adjclose values for the latest data point (market still open). Schema uses `type: [number, 'null']`.
- **Nullable rating fields** — some analyst ratings have null rating_current, pt_current, etc. when the analyst doesn't have an active rating. Schema uses nullable types.
- **Calendar events structure** — result is an object with event type keys (ipoEvents, earnings, splits), not an array.
- **Screener results cause DRIFT** — different stocks returned each call as market movers change. Expected for dynamic endpoints.
- **429 rate limiting** — Yahoo's CDN applies aggressive per-UA rate limiting to `Macintosh; Intel Mac OS X` Chrome UAs (common scraping fingerprint). On macOS, the auto-detected UA triggers this. Workaround: set a Windows Chrome UA in `$OPENWEB_HOME/config.json`: `{"userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"}`. If 429s persist, increase spacing between requests.
- **searchTickers response drift** — search results include dynamic news articles and trending data that change each call. Fingerprint is set to `pending` (drift expected).
