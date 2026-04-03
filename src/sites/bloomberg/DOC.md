# Bloomberg

## Overview
Financial news and market data. Top news headlines, breaking news, market ticker, and search via Bloomberg's Next.js SSR data.

## Workflows

### Browse market news
1. `getTickerBar` → market overview (top indices, bonds, commodities with prices)
2. `getNewsHeadlines` → top 50 editorial headlines
3. `getLatestNews` → breaking/latest news feed

### Search for information
1. `searchBloomberg(query)` → news articles, quotes, people

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getTickerBar | market overview | — | id, shortName, price, percentChange1Day | entry point; ~20 securities |
| getNewsHeadlines | top news | — | headline, abstract, url, publishedAt, byline | up to 50 stories |
| getLatestNews | breaking news | — | headline, abstract, url, publishedAt | up to 30 stories |
| searchBloomberg | search | query | headline, abstract, url, publishedAt, type | news, quotes, people |

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
```

---

## Site Internals

## API Architecture
- **Next.js SSR**: All data embedded in `__NEXT_DATA__` script tag — no separate API endpoints
- **PerimeterX bot detection**: Direct HTTP blocked; browser-only access (`transport: page`)
- Homepage has ~7MB of `__NEXT_DATA__` with 60+ editorial modules and a ticker bar

## Auth
No auth required. All 4 operations work on public Bloomberg pages. Bloomberg Terminal data (BLP) requires paid subscription — not accessible through web.

## Transport
- `transport: page` — browser fetch only (PerimeterX blocks node/direct HTTP)
- Bot detection: PerimeterX (px-cloud.net, perimeterx.net)
- Slow navigation required — rapid page loads trigger CAPTCHA

## Extraction
- `ssr_next_data` — direct path into `__NEXT_DATA__` JSON for simple extractions (getTickerBar)
- `page_global_data` — JavaScript expressions for complex extractions (getNewsHeadlines, getLatestNews, searchBloomberg)
- All data is in `__NEXT_DATA__` under `props.pageProps`
- Homepage: `initialState.tickerBar`, `initialState.modulesById`

## Known Issues
- **PerimeterX rate limiting**: Navigating too many pages in rapid succession triggers CAPTCHA. Space requests 5-10 seconds apart.
- **Nullable fields**: Some ticker fields return null for non-applicable security types (e.g., lastYield null for equities, percentChange1Day null for bonds).
- **Homepage data size**: ~7MB of `__NEXT_DATA__` — extraction filters to relevant fields only.
- **Delayed data**: `isExchangeDelayed: true` with 15-minute delay on most quotes.
- **Search page**: Uses a different Next.js page route; extraction falls back to modulesById.
- **Removed ops**: getBoardMembers, getIndexMembers — Bloomberg changed `__NEXT_DATA__` structure on quote pages; extractions return empty arrays (removed 2026-04-02).
