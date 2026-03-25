# Robinhood Fixture — Progress

## 2026-03-24: Initial discovery — 11 operations

**What changed:**
- Created robinhood with 11 operations: getInstruments, getStockQuotes, getStockFundamentals, getStockEarnings, getAnalystRatings, getStockNews, getCryptoQuote, getCryptoFundamentals, getCryptoHistoricals, getMarketHours, getDiscoveryLists
- Created openapi.yaml, manifest.json, DOC.md, PROGRESS.md

**Why:**
- Robinhood is a major stock/crypto trading platform — public market data pages provide stock quotes, crypto prices, fundamentals, ratings, and news without login
- All 11 operations work without auth via Robinhood's internal REST APIs (api.robinhood.com, dora.robinhood.com)
- Trading/account endpoints excluded — require OAuth bearer tokens

**Discovery process:**
1. Browsed Robinhood systematically via managed browser: stock pages (AAPL, TSLA, MSFT, NVDA, SPY), crypto pages (BTC, ETH, DOGE), collections (100-most-popular, technology, crypto)
2. Compiled captured traffic via `pnpm dev compile` — 51 raw operations generated, 46 verified
3. Curated to 11 operations: merged UUID-specific paths into parameterized paths (e.g. `/marketdata/fundamentals/{instrument_id}/`), removed noise (analytics/vegeta/kaizen experiments, microgram app assets, ETP details, disclosures, detail-page-live-updating-data)
4. All verified PASS via node transport

**Verification:** API-level (all 11 PASS), content-level (quotes return real bid/ask/last prices, fundamentals return real market cap/PE/description, crypto quotes return real prices, news returns real articles with sources)

**Knowledge updates:** None — Robinhood follows standard REST API patterns with UUID-based identifiers. No novel auth or extraction techniques.
