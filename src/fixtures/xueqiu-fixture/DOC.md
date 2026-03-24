# Xueqiu (雪球)

## Overview
Xueqiu (Snowball Finance) is China's largest stock discussion and portfolio platform. It combines real-time market data with social features — users follow stocks, share analysis, and discuss investment ideas.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getStockQuote | Get real-time price, volume, market cap for a stock | REST `stock.xueqiu.com/v5/stock/quote.json` | Extended detail includes PE, PB, 52w high/low |
| getMarketIndices | Batch quote for market indices or watchlist | REST `stock.xueqiu.com/v5/stock/batch/quote.json` | Defaults to 6 major CN indices |
| getKlineChart | K-line (candlestick) OHLCV chart data | REST `stock.xueqiu.com/v5/stock/chart/kline.json` | Supports 1m to yearly periods |
| suggestStock | Typeahead stock search as user types | REST `xueqiu.com/query/v1/suggest_stock.json` | Matches pinyin, Chinese name, ticker |
| getHotPosts | Trending discussions from community | REST `xueqiu.com/statuses/hot/listV2.json` | Cursor-based pagination via max_id |
| searchPosts | Full-text search of user posts | REST `xueqiu.com/query/v1/search/status.json` | HTML highlight, page-based pagination |
| searchUsers | Find investors, analysts, KOLs by keyword | REST `xueqiu.com/query/v1/search/user.json` | Returns follower counts, verification status |
| getFinancialIncome | Income statement for recent quarters | REST `stock.xueqiu.com/v5/stock/finance/cn/income.json` | Revenue, net profit with YoY growth |
| getFinancialIndicators | Key financial ratios per quarter | REST `stock.xueqiu.com/v5/stock/finance/cn/indicator.json` | ROE, EPS, cash flow per share |
| getStockScreener | Ranked stock list by metrics | REST `xueqiu.com/service/v5/stock/screener/quote/list` | Filter by market, sort by change/cap/volume |

## API Architecture
- **Two API hosts**: `stock.xueqiu.com` (4 operations: quote, batch, kline, financials) and `xueqiu.com` (6 operations: search, social, screener)
- **REST endpoints**: All JSON responses with `{data, error_code, error_description}` wrapper for stock APIs, flat JSON for social APIs
- **Pagination**: Cursor-based (max_id) for hot posts, page-based for search, count-based for financials
- **Stock symbols**: Market prefix format — `SH` (Shanghai), `SZ` (Shenzhen), no prefix for US stocks (e.g. `AAPL`)

## Auth
- No login required for all 10 operations
- Browser must visit xueqiu.com first to obtain `xq_a_token` cookie — this cookie is required for all API requests
- Cookie-based session: `xq_a_token`, `xqat`, `xq_r_token` set automatically on first page load

## Transport
- `transport: page` — all operations require browser context
- Direct HTTP requests are blocked without valid `xq_a_token` cookie
- Cookie is tied to browser session (set via JavaScript on page load), cannot be obtained via node fetch

## Extraction
- **Adapter-based**: `xueqiu-api.ts` handles all 10 operations via `page.evaluate(fetch(...))`
- All APIs return clean JSON — no DOM parsing needed
- Stock APIs use `{data: {...}, error_code: 0}` envelope
- Social APIs use flat JSON with `{count, list, page, maxPage}` pattern

## Known Issues
- Stock timeline API (`/statuses/stock_timeline.json`) returns empty for some symbols — excluded in favor of search
- Market hours affect quote data: outside trading hours, `current` reflects last close
- Financial data only available for CN-listed stocks (not US/HK)
- `xq_a_token` cookie expires after ~24h, requiring a fresh page visit to renew
