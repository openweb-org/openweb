# Xueqiu (雪球)

## Overview
Chinese finance and social investing platform. Stock quotes, order book, industry comparisons, market events, and social discussion feed.

## Workflows

### Search and inspect a stock
1. `searchStocks(q)` → results with `code` (ticker symbol, e.g. SH600519)
2. `getStockQuote(symbol)` → real-time price, volume, market cap
3. `getOrderBook(symbol)` → bid/ask depth at 5 levels

### Analyze stock history and fundamentals
1. `searchStocks(q)` → find stock `code`
2. `getStockKline(symbol, begin, period)` → historical candlestick data (OHLCV)
3. `getStockFinancials(symbol)` → ROE, EPS, revenue, net profit per period

### Community sentiment on a stock
1. `searchStocks(q)` → find stock `code`
2. `getStockComments(symbol)` → user posts and discussions about the stock

### Compare industry peers
1. `searchStocks(q)` → find stock `code`
2. `getIndustryStocks(code)` → all stocks in same industry with price, PE, market cap

### Browse market activity
1. `getHotEvents` → trending market topics with heat scores
2. `getTimeline` → social discussion feed with posts and authors

### Track watchlist
1. `getWatchlist(pid)` → user's followed stocks with live prices (requires login)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchStocks | search stocks by keyword | q | code, name, exchange, current, percentage | entry point |
| getStockQuote | real-time stock quote | symbol ← searchStocks.code | current, percent, chg, volume, market_capital, high, low | supports batch (comma-separated) |
| getOrderBook | bid/ask order book | symbol ← searchStocks.code | bp1-5/bc1-5 (bids), sp1-5/sc1-5 (asks) | A-share stocks only |
| getStockKline | candlestick chart data | symbol, begin (ms timestamp), period | column names + OHLCV data arrays | periods: day/week/month/1m-120m |
| getStockFinancials | financial indicators | symbol, type (Q1-Q4/all), count | avg_roe, basic_eps, total_revenue, net_profit, gross_margin | CN A-share stocks |
| getStockComments | stock discussion feed | symbol, count, sort, source | posts with description, author, reply_count, fav_count | paginated |
| getWatchlist | user's stock watchlist | pid (-1 for default) | symbol, name, current, percent, market_capital | requires login |
| getHotEvents | trending market events | count (optional) | tag, hot, status_count, content | entry point |
| getTimeline | hot discussion feed | since_id, max_id, size | posts with title, description, author, timestamps | paginated via next_max_id |
| getIndustryStocks | industry peer stocks | code ← searchStocks.code | symbol, name, current, percentage, pe_ttm, marketCapital | |

## Quick Start

```bash
# Search for a stock
openweb xueqiu exec searchStocks '{"q":"茅台","count":10}'

# Get real-time quote (supports batch: "SH600519,AAPL")
openweb xueqiu exec getStockQuote '{"symbol":"SH600519"}'

# Get order book depth
openweb xueqiu exec getOrderBook '{"symbol":"SH600519"}'

# Get K-line chart data (30 days before timestamp)
openweb xueqiu exec getStockKline '{"symbol":"SH600519","begin":1712505600000,"period":"day","count":-30}'

# Get financial indicators (last 5 annual reports)
openweb xueqiu exec getStockFinancials '{"symbol":"SH600519","type":"Q4","count":5}'

# Get stock community discussion
openweb xueqiu exec getStockComments '{"symbol":"SH600519","count":10,"sort":"time"}'

# Get user's watchlist (requires login)
openweb xueqiu exec getWatchlist '{"pid":-1,"category":1,"size":100}'

# Get hot market events
openweb xueqiu exec getHotEvents '{"count":10}'

# Browse social timeline
openweb xueqiu exec getTimeline '{"since_id":-1,"max_id":-1,"size":15}'

# Get industry peers
openweb xueqiu exec getIndustryStocks '{"code":"SH600519","type":1,"size":30}'
```

---

## Site Internals

## API Architecture
REST API split across two domains:
- `xueqiu.com` — search, events, timeline, industry data
- `stock.xueqiu.com` — quotes, order book, stock data

JSON responses. Some endpoints use anti-bot `md5__1038` hash parameter (removed from spec — not needed for node transport with cookies).

## Auth
`xq_a_token` cookie auto-set on first page load (24h expiry). No login required for public data. Cookie-based session auth via `cookie_session`.

## Transport
Node transport with cookie_session auth for most operations. Cookies extracted from browser once and cached. The `stock.xueqiu.com` endpoints share cookies cross-domain. `getTimeline` uses page transport (browser-fetch) because the `/statuses/hot/listV2.json` endpoint returns HTML instead of JSON to node requests without the `md5__1038` anti-bot hash. `getStockKline`, `getStockFinancials`, and `getWatchlist` also use page transport — these `stock.xueqiu.com` endpoints return HTTP 400 from node, likely requiring browser context for additional validation.

## Known Issues
- `xq_a_token` expires after 24h — browser reload refreshes it
- `getTimeline` may return HTML instead of JSON if cookies are missing or expired
- `getWatchlist` requires user login — anonymous session returns error 60201 (invalid user ID)
- Rate limiting on rapid requests — keep request intervals at 1-2s
- Stock symbols follow exchange prefixes: SH (Shanghai), SZ (Shenzhen), no prefix for US stocks
