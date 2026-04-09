## 2026-04-09: Enhance to 10 operations

**What changed:**
- Added 4 operations: getStockKline, getStockFinancials, getStockComments, getWatchlist
- Total: 10 operations (6 existing + 4 new)
- getStockKline, getStockFinancials, getWatchlist use page transport (stock.xueqiu.com returns 400 from node for these endpoints)
- getStockComments uses node transport (xueqiu.com domain)
- DOC.md updated with new workflows (history/fundamentals, community sentiment, watchlist)

**Why:**
- Competitive gap: OpenCLI has 12 ops, we had 6
- K-line and financials are core for stock analysis workflows
- Stock comments enable community sentiment analysis

**Verification:** 9/9 operations PASS via `openweb verify xueqiu` (getWatchlist excluded — requires user login)
**Commit:** pending

## 2026-04-01: Initial discovery and compilation

**What changed:**
- Net-new site package for xueqiu.com (雪球)
- 6 operations: searchStocks, getStockQuote, getOrderBook, getHotEvents, getTimeline, getIndustryStocks
- Auth: cookie_session (xq_a_token auto-set on page load)
- Transport: node with browser cookie extraction

**Why:**
- User requested xueqiu discovery targeting getStock, getStockQuote, searchStocks, getTimeline
- Expanded to include getOrderBook and getIndustryStocks for finance workflow coverage
- f10 company detail endpoints (getStock equivalent) return 400 from node — require page context. Deferred to future iteration.

**Verification:** 5/6 operations PASS via `openweb verify xueqiu` (getTimeline returns HTML on stale cookies)
**Commit:** pending
