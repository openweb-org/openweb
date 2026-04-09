# Bloomberg

## Overview
Financial news and market data. Top news headlines, breaking news, market ticker, search, company profiles, stock charts, and market overview via Bloomberg's Next.js SSR data.

## Workflows

### Browse market news
1. `getTickerBar` → market overview (top indices, bonds, commodities with prices)
2. `getNewsHeadlines` → top 50 editorial headlines
3. `getLatestNews` → breaking/latest news feed

### Research a company
1. `searchBloomberg(query)` → find ticker symbol
2. `getCompanyProfile(ticker)` → company description, sector, market cap, employees
3. `getStockChart(ticker)` → current price, daily stats, 1Y/5Y price history

### Market overview
1. `getMarketOverview` → indices, bonds, commodities, currencies with prices and changes
2. `getTickerBar` → quick snapshot of top securities

### Search for information
1. `searchBloomberg(query)` → news articles, quotes, people

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getTickerBar | market overview | — | id, shortName, price, percentChange1Day | entry point; ~20 securities |
| getNewsHeadlines | top news | — | headline, abstract, url, publishedAt, byline | up to 50 stories |
| getLatestNews | breaking news | — | headline, abstract, url, publishedAt | up to 30 stories |
| searchBloomberg | search | query | headline, abstract, url, publishedAt, type | news, quotes, people |
| getCompanyProfile | company info | ticker | name, description, sector, marketCap, employees | sub-page; PerimeterX may block |
| getStockChart | stock price/chart | ticker | price, change, open/high/low, priceHistory1Y/5Y | sub-page; 15-min delayed |
| getMarketOverview | market indices | — | indices, bonds, commodities, currencies | sub-page; categorized by asset class |

## Quick Start

```bash
# Market overview — top indices/bonds/commodities
openweb bloomberg exec getTickerBar '{}'

# Top news headlines
openweb bloomberg exec getNewsHeadlines '{}'

# Latest breaking news
openweb bloomberg exec getLatestNews '{}'

# Search for AI news
openweb bloomberg exec searchBloomberg '{"query":"artificial intelligence"}'

# Company profile (requires /profile/company/AAPL:US tab open)
openweb bloomberg exec getCompanyProfile '{"ticker":"AAPL:US"}'

# Stock chart with price history (requires /quote/AAPL:US tab open)
openweb bloomberg exec getStockChart '{"ticker":"AAPL:US"}'

# Market overview — indices, bonds, commodities, currencies (requires /markets tab open)
openweb bloomberg exec getMarketOverview '{}'
```

---

## Site Internals

## API Architecture
- **Next.js SSR**: All data embedded in `__NEXT_DATA__` script tag — no separate API endpoints
- **PerimeterX bot detection**: Direct HTTP blocked; browser-only access (`transport: page`)
- Homepage has ~7MB of `__NEXT_DATA__` with 60+ editorial modules and a ticker bar

## Auth
No auth required. All 7 operations work on public Bloomberg pages. Bloomberg Terminal data (BLP) requires paid subscription — not accessible through web.

## Transport
- `transport: page` — browser fetch only (PerimeterX blocks node/direct HTTP)
- Bot detection: PerimeterX (px-cloud.net, perimeterx.net)
- Slow navigation required — rapid page loads trigger CAPTCHA

## Extraction
- `ssr_next_data` — direct path into `__NEXT_DATA__` JSON for simple extractions (getTickerBar)
- `page_global_data` — JavaScript expressions for complex extractions (all other operations)
- All data is in `__NEXT_DATA__` under `props.pageProps`
- Homepage: `initialState.tickerBar`, `initialState.modulesById`
- Quote page: `initialState.quote` (price, chart data, priceMovements)
- Profile page: `initialState.company` (description, sector, market cap)
- Markets page: categorized arrays (indices, bonds, commodities, currencies)

## Known Issues
- **PerimeterX rate limiting**: Navigating too many pages in rapid succession triggers CAPTCHA. Space requests 5-10 seconds apart.
- **Sub-page navigation blocked**: PerimeterX blocks programmatic `page.goto()` to sub-pages (`/quote/`, `/profile/`, `/markets`). Operations targeting these pages require the user to manually open the tab in the browser first. Homepage-based operations (`getTickerBar`, `getNewsHeadlines`, `getLatestNews`, `searchBloomberg`) are unaffected.
- **Nullable fields**: Some ticker fields return null for non-applicable security types (e.g., lastYield null for equities, percentChange1Day null for bonds).
- **Homepage data size**: ~7MB of `__NEXT_DATA__` — extraction filters to relevant fields only.
- **Delayed data**: `isExchangeDelayed: true` with 15-minute delay on most quotes.
- **Search page**: Uses a different Next.js page route; extraction falls back to modulesById.
- **Removed ops**: getBoardMembers, getIndexMembers — Bloomberg changed `__NEXT_DATA__` structure on quote pages; extractions return empty arrays (removed 2026-04-02).
