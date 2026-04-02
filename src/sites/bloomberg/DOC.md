# Bloomberg

## Overview
Financial news and market data. Stock/index/commodity quotes, price charts, company profiles, board members, and top news headlines via Bloomberg's Next.js SSR data.

## Workflows

### Get a security quote with details
1. `getQuote(ticker)` → price, change, fundamentals
2. `getCompanyProfile(ticker)` → description, sector, employees (equities only)
3. `getPriceChart(ticker)` → 1Y and 5Y historical prices
4. `getPriceMovements(ticker)` → 1D/1M/6M/YTD/1Y/5Y movements
5. `getBoardMembers(ticker)` → executives and board (equities only)

### Get index composition
1. `getQuote(ticker)` → index price and change (e.g. "SPX:IND")
2. `getIndexMembers(ticker)` → component securities with prices

### Browse market news
1. `getTickerBar` → market overview (top indices, bonds, commodities)
2. `getNewsHeadlines` → top 50 editorial headlines
3. `getLatestNews` → breaking/latest news feed

### Search for information
1. `searchBloomberg(query)` → news articles, quotes, people

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getTickerBar | market overview | — | id, shortName, price, percentChange1Day | entry point; ~20 securities |
| getNewsHeadlines | top news | — | headline, abstract, url, publishedAt, byline | up to 50 stories |
| getQuote | security quote | ticker | price, change, PE, EPS, dividend, 52wk range | entry point; price is string |
| getCompanyProfile | company info | ticker ← getQuote | description, sector, employees, website | equities only |
| getPriceChart | historical prices | ticker ← getQuote | oneYear[], fiveYear[] (date + value) | |
| getPriceMovements | price history | ticker ← getQuote | 1D/1M/6M/YTD/1Y/5Y arrays | |
| getBoardMembers | executives | ticker ← getQuote | name, title, type | equities only |
| getIndexMembers | index components | ticker ← getQuote | id, name, price, percentChange1Day | indices only (SPX:IND, INDU:IND) |
| getLatestNews | breaking news | — | headline, abstract, url, publishedAt | up to 30 stories |
| searchBloomberg | search | query | headline, abstract, url, publishedAt, type | news, quotes, people |

## Quick Start

```bash
# Market overview — top indices/bonds/commodities
openweb bloomberg exec getTickerBar '{}'

# Get Apple stock quote
openweb bloomberg exec getQuote '{"ticker":"AAPL:US"}'

# Get S&P 500 index members
openweb bloomberg exec getIndexMembers '{"ticker":"SPX:IND"}'

# Top news headlines
openweb bloomberg exec getNewsHeadlines '{}'

# Search for AI news
openweb bloomberg exec searchBloomberg '{"query":"artificial intelligence"}'

# Company profile
openweb bloomberg exec getCompanyProfile '{"ticker":"MSFT:US"}'
```

---

## Site Internals

## API Architecture
- **Next.js SSR**: All data embedded in `__NEXT_DATA__` script tag — no separate API endpoints
- **PerimeterX bot detection**: Direct HTTP blocked; browser-only access (`transport: page`)
- Page data varies by security type: equities have company profile + board members, indices have index members
- Homepage has ~7MB of `__NEXT_DATA__` with 60+ editorial modules and a ticker bar

## Auth
No auth required. All 10 operations work on public Bloomberg pages. Bloomberg Terminal data (BLP) requires paid subscription — not accessible through web.

## Transport
- `transport: page` — browser fetch only (PerimeterX blocks node/direct HTTP)
- Bot detection: PerimeterX (px-cloud.net, perimeterx.net)
- Slow navigation required — rapid page loads trigger CAPTCHA

## Extraction
- `ssr_next_data` — direct path into `__NEXT_DATA__` JSON for simple extractions (getTickerBar, getQuote)
- `page_global_data` — JavaScript expressions for complex extractions (getNewsHeadlines, getCompanyProfile, getPriceMovements, getPriceChart, getBoardMembers, getIndexMembers, getLatestNews, searchBloomberg)
- All data is in `__NEXT_DATA__` under `props.pageProps`
- Homepage: `initialState.tickerBar`, `initialState.modulesById`
- Quote pages: `pageProps.quote` (includes priceMovements), `pageProps.boardMembersAndExecutives` (object with boardMembers + executives arrays), `pageProps.barCharts` (financial statements, not price charts)

## Known Issues
- **PerimeterX rate limiting**: Navigating too many pages in rapid succession triggers CAPTCHA. Space requests 5-10 seconds apart.
- **Nullable fields**: Many quote fields return null for non-applicable security types (e.g., dividend for indices, indexMembers for stocks).
- **Price as string**: Quote `price` field is a string (e.g., "253.63"), not a number.
- **Homepage data size**: ~7MB of `__NEXT_DATA__` — extraction filters to relevant fields only.
- **Delayed data**: `isExchangeDelayed: true` with 15-minute delay on most quotes.
- **Search page**: Uses a different Next.js page route; extraction falls back to modulesById.
