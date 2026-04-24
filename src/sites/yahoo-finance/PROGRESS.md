# Yahoo Finance Fixture — Progress

## 2026-04-24: Userflow QA — adapter trimming + schema fix

**What changed:**
- Added trimming adapter (`adapters/yahoo-finance.ts`) for all 9 ops
  - getScreener: 88 fields/quote → 16 essential fields, flattened `{raw,fmt}` → raw values
  - getCalendarEvents: 293KB → 28KB (capped to 7 days per event type, trimmed record fields)
  - getInsights: 43KB → compact (capped secReports to 10, dropped upsell/reports/events noise)
  - getSparkline: trimmed meta (dropped tradingPeriods, validRanges, currentTradingPeriod)
  - searchTickers, getChart, getRatings, getTimeSeries, getQuoteType: pass-through (already compact)
- Fixed getInsights schema: `companySnapshot` and `recommendation` made optional (ETFs don't have them)
- Updated getScreener schema to match flattened output (raw values, not `{raw,fmt}` objects)
- Updated getCalendarEvents schema: added economicEvents, trimmed record schemas, removed old splits

**Userflow QA — 3 blind persona tests:**
1. **Retail investor** (NVDA): search → quote type → chart 1mo → ratings → insights → time series → calendar — all PASS
2. **Portfolio manager**: screener (most_actives, day_gainers, day_losers) → sparkline (^GSPC,^DJI,^IXIC) → calendar — all PASS
3. **Student** (S&P 500 ETF): search "S&P 500 ETF" → quote type SPY → chart 5y → insights SPY → sparkline (SPY,VOO,IVV) — all PASS

**Known limitations:**
- getRatings returns 404 for non-equities (ETFs, indices) — Yahoo API limitation, not fixable
- getTimeSeries returns empty data for ETFs (no fundamental metrics) — expected behavior

**Verification:** `pnpm dev verify yahoo-finance` — 9/9 PASS

---

## 2026-04-13: Verify fix — x-openweb.headers + inter-op delay

**What changed:**
- Added `x-openweb.headers` with browser User-Agent to server block and per-op overrides — prevents 429 rate limiting on node transport
- Verify now passes 9/9 with 1.5s inter-op delay (infrastructure change in verify.ts)

**Why:** All 9 ops returned 429 during batch verify. Yahoo Finance rate-limits requests without browser-like UA.

---

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
