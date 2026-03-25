# Bloomberg Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created bloomberg with 10 operations: getTickerBar, getNewsHeadlines, getQuote, getCompanyProfile, getPriceChart, getPriceMovements, getBoardMembers, getIndexMembers, getLatestNews, searchBloomberg

**Why:**
- Bloomberg is a key financial data source — market indices, stock quotes, company profiles, and financial news
- All 10 operations work without auth via Next.js SSR extraction from `__NEXT_DATA__`
- Bloomberg uses PerimeterX bot detection — only browser-based access works (transport: page)

**Discovery process:**
1. Captured traffic from 14 Bloomberg pages — all 54 captured HTTP requests were PerimeterX bot detection traffic (no separate API endpoints)
2. Discovered Bloomberg is a Next.js app with massive `__NEXT_DATA__` (7MB on homepage)
3. Inspected `__NEXT_DATA__` structure: homepage has `tickerBar` (20 market tickers) and `modulesById` (61 news modules); quote pages have `quote`, `barCharts`, `boardMembersAndExecutives`, `indexMembers`
4. Built fixture manually using `ssr_next_data` for simple path extractions and `page_global_data` for complex aggregations (news headlines, company profile, price movements)
5. Verified homepage and quote pages load correctly with proper delays (8-10s between navigations)

**Verification:** Content-level verification confirmed: tickerBar returns real market indices (SPX 6577, NASDAQ 21777, BBG500 2366, oil CL1 92.54), quote page returns real AAPL data (price $253.63, PE ratio, market cap, 52-week range), barCharts returns daily price history.

**Knowledge updates:** Bloomberg uses PerimeterX for bot detection. Next.js SSR with no separate API endpoints — all data in `__NEXT_DATA__`. Rapid navigation triggers CAPTCHA; space 5-10s between pages.
