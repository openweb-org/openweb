## 2026-04-09: Expand to 7 operations — company profiles, stock charts, market overview

**What changed:**
- Added 3 new operations: getCompanyProfile, getStockChart, getMarketOverview
- getCompanyProfile extracts from `/profile/company/{ticker}` — name, description, sector, market cap, employees
- getStockChart extracts from `/quote/{ticker}` — current price, daily stats, 1Y/5Y price history
- getMarketOverview extracts from `/markets` — indices, bonds, commodities, currencies
- All use page_global_data extraction with multi-path fallbacks
- DOC.md updated with new workflows (research a company, market overview)

**Why:**
- Bloomberg had only 4 homepage-based operations after the 2026-04-02 cleanup
- Company/quote/market data is high-value but requires sub-page navigation
- Sub-page ops require manual tab opening due to PerimeterX blocking programmatic navigation

**Known limitation:** getCompanyProfile, getStockChart, getMarketOverview target sub-pages that PerimeterX may block. User must open the target page in the browser before executing.

## 2026-04-01: Fresh rediscovery — 10 operations via SSR extraction

**What changed:**
- Rediscovered Bloomberg from scratch after prior package was deleted
- 10 operations: getTickerBar, getNewsHeadlines, getQuote, getCompanyProfile, getPriceChart, getPriceMovements, getBoardMembers, getIndexMembers, getLatestNews, searchBloomberg
- All operations use page transport with ssr_next_data or page_global_data extraction
- No auth required — all public content

**Why:**
- Prior package deleted during batch site cleanup; recreating fresh with same proven extraction patterns
- Bloomberg is an SSR-only site (PerimeterX blocks node transport) — auto-compile produced 53 noise operations from internal APIs; manual curation reduced to 10 focused operations

**Verification:** Runtime verify with browser, spec standards, doc template
