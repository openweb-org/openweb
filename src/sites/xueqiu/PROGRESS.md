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
