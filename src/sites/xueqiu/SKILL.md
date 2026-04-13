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

### Manage watchlist
1. `searchStocks(q)` → find stock `code`
2. `addToWatchlist(symbol, pid)` → add stock to watchlist (requires login)
3. `getWatchlist(pid)` → confirm stock was added
4. `removeFromWatchlist(symbol, pid)` → remove stock from watchlist

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
| addToWatchlist | add stock to watchlist | symbol, pid | success, error_code | requires login, write |
| removeFromWatchlist | remove stock from watchlist | symbol, pid | success, error_code | requires login, write |
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

# Add stock to watchlist (requires login)
openweb xueqiu exec addToWatchlist '{"symbol":"SH600519","pid":-1}'

# Remove stock from watchlist (requires login)
openweb xueqiu exec removeFromWatchlist '{"symbol":"SH600519","pid":-1}'

# Get hot market events
openweb xueqiu exec getHotEvents '{"count":10}'

# Browse social timeline
openweb xueqiu exec getTimeline '{"since_id":-1,"max_id":-1,"size":15}'

# Get industry peers
openweb xueqiu exec getIndustryStocks '{"code":"SH600519","type":1,"size":30}'
```
