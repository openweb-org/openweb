# Xueqiu Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created xueqiu-fixture with 10 operations: getStockQuote, getMarketIndices, getKlineChart, suggestStock, getHotPosts, searchPosts, searchUsers, getFinancialIncome, getFinancialIndicators, getStockScreener
- Adapter: `xueqiu-api.ts` — all REST via browser fetch

**Why:**
- Xueqiu is China's dominant retail investor platform (40M+ users) — essential for Chinese stock data coverage
- All stock quote, chart, and financial APIs are public (no login needed), making it a reliable data source
- Social features (hot posts, search) complement market data for sentiment analysis

**Discovery process:**
1. Browsed xueqiu.com homepage in CDP browser to establish session cookies (xq_a_token)
2. Probed 15 API endpoints via page.evaluate(fetch) — identified 12 working endpoints
3. Selected 10 operations covering: market data (4), social/search (3), financials (2), screening (1)
4. Built adapter with shared apiFetch helper for consistent error handling
5. Verified all 10 endpoints return 200 with structured data

**Verification:** All 10 operations confirmed returning valid JSON with expected data fields. Stock quote returns ~60 fields per symbol. Financial APIs return quarterly data with YoY growth rates.

**Knowledge updates:** Chinese finance sites (xueqiu, eastmoney) share a pattern: public REST APIs gated by session cookies set on first page load. No bot detection library (no PerimeterX/DataDome), but direct HTTP without cookies returns 400. The cookie handshake is JavaScript-based, requiring browser context.
