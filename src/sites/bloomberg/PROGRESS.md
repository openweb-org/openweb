## 2026-04-25: Userflow QA — adapter trimming and PerimeterX blocking

**Workflows tested:**
1. "Morning Market Brief" (Financial Analyst): getTickerBar → getNewsHeadlines → getLatestNews — all 3 chained successfully
2. "Stock Research" (Retail Investor): getTickerBar → getStockChart — getStockChart blocked by PerimeterX
3. "News Deep Dive" (Journalist): getLatestNews → getNewsHeadlines → getTickerBar — all 3 chained successfully

**Gaps found:**
- getNewsHeadlines: 20KB/117 items response bloat, always-empty topics, always-null imageUrl fields
- getTickerBar: `__typename`, `name`, `longName`, `realTimeTickerDescription` noise fields
- getStockChart: 21KB response with 512 price history points; price/open/volume/marketCap returned as strings not numbers
- All 7 ops behind PerimeterX CAPTCHA — homepage ops work intermittently, sub-page ops consistently blocked

**Fixes:**
- Added `adapters/bloomberg.ts` — trims and coerces responses for getTickerBar, getNewsHeadlines, getLatestNews, getStockChart
- getNewsHeadlines: 20KB → 7.6KB (117 → 25 items, dropped abstract/updatedAt/type/imageUrl/topics)
- getTickerBar: stripped __typename/name/longName/realTimeTickerDescription noise
- getStockChart: added page_plan with entry_url; downsamples 1Y to 52 weekly points, 5Y to 60 monthly points; coerces string values to numbers
- getLatestNews: caps at 15 items, drops abstract field
- Marked all 7 ops `requires_interactive_solve` — PerimeterX blocks all Bloomberg pages under bot traffic
- Updated schema to match trimmed adapter output

**Before/after sizes:**
- getTickerBar: 4.6KB → inline (~1.8KB)
- getNewsHeadlines: 20KB → 7.6KB
- getLatestNews: 1.5KB → 1.5KB (already small)
- getStockChart: 21KB → ~6KB (estimated from downsampling)

**Blocker:** PerimeterX CAPTCHA blocks all ops under sustained automated access. Homepage ops work for initial requests but trigger CAPTCHA after several calls. All ops now marked `requires_interactive_solve`.

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
