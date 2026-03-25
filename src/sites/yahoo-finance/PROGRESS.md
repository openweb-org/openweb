# Yahoo Finance Fixture — Progress

## 2026-03-24: Initial discovery — 9 operations

**What changed:**
- Created yahoo-finance with 9 operations: searchTickers, getChart, getSparkline, getScreener, getRatings, getInsights, getTimeSeries, getCalendarEvents, getQuoteType
- Created openapi.yaml, manifest.json, DOC.md, PROGRESS.md, and 9 test files

**Why:**
- Yahoo Finance is a key financial data source — stock quotes, charts, financials are high-value operations
- All 9 operations work without auth via Yahoo's internal REST APIs (query1/query2.finance.yahoo.com)
- v7/finance/quote (real-time quotes) excluded — requires crumb (session CSRF token), not accessible without browser auth

**Discovery process:**
1. Wrote Playwright recording script (scripts/record_yahoo_finance.ts) to browse Yahoo Finance systematically
2. Compiled captured traffic via `pnpm dev compile` — 18 raw operations generated, 16 verified
3. Curated to 10 target operations: merged ticker-specific paths (AAPL/MSFT → {symbol}), removed noise (analytics, DOM extractions, POST mutations)
4. Removed getQuote (v7/finance/quote) after discovering it requires crumb auth — 9 final operations
5. Fixed schemas: nullable chart values (current trading day), nullable rating fields, calendar events object structure
6. All 9 operations verified PASS via `pnpm dev verify`

**Verification:** API-level (all 9 PASS), content-level (search returns real tickers with name/exchange/sector, chart returns real OHLCV data matching yahoo.com, timeseries returns actual Apple revenue/income figures, ratings show real analyst data)

**Knowledge updates:** None — Yahoo Finance follows standard REST API patterns, no novel auth or extraction techniques discovered.
