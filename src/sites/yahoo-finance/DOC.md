# Yahoo Finance

## Overview
Financial data portal. Stock quotes, charts, financials, market screeners, analyst ratings, and company insights via Yahoo Finance internal APIs.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchTickers | search by keyword | GET /v1/finance/search?q={q} | returns quotes (symbol, name, exchange, sector) + related news |
| getChart | historical price data | GET /v8/finance/chart/{symbol} | OHLCV data with configurable range/interval, includes dividends/splits |
| getSparkline | quick price snapshot | GET /v7/finance/spark?symbols={s} | mini chart with close prices + meta (current price, prev close, volume) |
| getScreener | market movers | GET /v1/finance/screener/predefined/saved?scrIds={id} | most_actives, day_gainers, day_losers with formatted price data |
| getRatings | analyst ratings | GET /v2/ratings/top/{symbol} | top-rated analysts' directional, momentum, price target, and financial scores |
| getInsights | company insights | GET /ws/insights/v3/finance/insights?symbols={s} | technicals, valuation, company snapshot, recommendations, SEC filings |
| getTimeSeries | financial fundamentals | GET /ws/fundamentals-timeseries/v1/finance/timeseries/{symbol} | annual/quarterly revenue, income, EPS, etc. with historical timestamps |
| getCalendarEvents | market calendar | GET /ws/screeners/v1/finance/calendar-events | IPOs, earnings, splits by date |
| getQuoteType | symbol metadata | GET /v1/finance/quoteType/?symbol={s} | equity/ETF/index/crypto classification, exchange, timezone |

## API Architecture
- **Two API hosts**: `query1.finance.yahoo.com` and `query2.finance.yahoo.com` — both serve data, some endpoints are on one or the other
- Internal APIs used by the finance.yahoo.com frontend — no official documentation
- Most read endpoints are public (no auth required)
- **v7/finance/quote requires crumb** — session-specific CSRF token obtained from Yahoo's consent flow. Not included in fixture — use getSparkline or getChart for current price data instead
- v10/finance/quoteSummary also requires crumb
- Search, chart, spark, screener, ratings, insights, timeseries, calendar, quoteType endpoints all work without auth

## Auth
- No auth needed for the 9 included operations
- `requires_auth: false`
- v7/quote and v10/quoteSummary require a `crumb` parameter (Yahoo's session CSRF)

## Transport
- `transport: node` — direct HTTP fetch from Node.js
- No bot detection on the API endpoints (query1/query2 subdomains)
- The main site (finance.yahoo.com) uses standard browser rendering but API calls are clean REST

## Extraction
- All operations return JSON directly — no SSR extraction needed
- Response schemas vary: some use raw/fmt objects (screener, ratings), some use flat numbers (chart, spark)

## Known Issues
- **Null values in chart data** — current trading day may have null close/adjclose values for the latest data point (market still open). Schema uses `type: [number, 'null']`.
- **Nullable rating fields** — some analyst ratings have null rating_current, pt_current, etc. when the analyst doesn't have an active rating. Schema uses nullable types.
- **Calendar events structure** — result is an object with event type keys (ipoEvents, earnings, splits), not an array.
- **Screener search results cause DRIFT** — different stocks returned each call as market movers change. Expected for dynamic endpoints.
