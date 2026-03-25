# Bloomberg

## Overview
Financial news and market data. Stock/index/commodity quotes, price charts, company profiles, board members, and top news headlines via Bloomberg's Next.js SSR data.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getTickerBar | market overview | GET / | top 20 indices/bonds/commodities with live prices from homepage ticker bar |
| getNewsHeadlines | top news stories | GET / | aggregated headlines from all homepage editorial modules (50+ stories) |
| getQuote | security quote | GET /quote/{ticker} | full quote: price, change, fundamentals, 52wk range, PE, EPS, dividend |
| getCompanyProfile | company info | GET /quote/{ticker} | description, sector, employees, founded year, website, address |
| getPriceChart | historical prices | GET /quote/{ticker} | 1-year and 5-year bar chart data (date + closing price) |
| getPriceMovements | price history | GET /quote/{ticker} | movements for 1D/1M/6M/YTD/1Y/5Y periods |
| getBoardMembers | executives | GET /quote/{ticker} | board members and executives with names and titles |
| getIndexMembers | index components | GET /quote/{ticker} | component securities of an index (SPX, INDU, etc.) |
| getLatestNews | breaking news | GET / | latest/breaking news feed from homepage |
| searchBloomberg | search | GET /search?query={q} | search Bloomberg for news, quotes, people |

## API Architecture
- **Next.js SSR**: All data embedded in `__NEXT_DATA__` script tag — no separate API endpoints
- **PerimeterX bot detection**: Direct HTTP blocked; browser-only access (`transport: page`)
- Page data varies by security type: equities have company profile + board members, indices have index members, funds have holdings
- Homepage has ~7MB of `__NEXT_DATA__` with 60+ editorial modules and a ticker bar

## Auth
- No auth needed for the 10 included operations
- `requires_auth: false`
- Bloomberg Terminal data (BLP) requires paid subscription — not accessible through web

## Transport
- `transport: page` — browser fetch only (PerimeterX blocks node/direct HTTP)
- Bot detection: PerimeterX (px-cloud.net, perimeterx.net)
- Slow navigation required — rapid page loads trigger CAPTCHA ("Are you a robot?")

## Extraction
- `ssr_next_data` — direct path into `__NEXT_DATA__` JSON for simple extractions
- `page_global_data` — JavaScript expressions for complex extractions (news aggregation, company profile)
- All data is in `__NEXT_DATA__` under `props.pageProps` — no DOM scraping needed
- Homepage: `initialState.tickerBar`, `initialState.modulesById`
- Quote pages: `pageProps.quote`, `pageProps.barCharts`, `pageProps.boardMembersAndExecutives`, `pageProps.indexMembers`

## Known Issues
- **PerimeterX rate limiting**: Navigating too many pages in rapid succession triggers CAPTCHA. Space requests 5-10 seconds apart.
- **Nullable fields**: Many quote fields return null for non-applicable security types (e.g., dividend for indices, indexMembers for stocks).
- **Price as string**: Quote `price` field is a string (e.g., "253.63"), not a number. Most other fields (percentChange, priceChange) are numbers.
- **Homepage data size**: ~7MB of `__NEXT_DATA__` — extraction filters to relevant fields only.
- **Delayed data**: `isExchangeDelayed: true` with 15-minute delay on most quotes.
- **Search page**: May use a different Next.js page route; extraction falls back to modulesById if dedicated search results not found.
