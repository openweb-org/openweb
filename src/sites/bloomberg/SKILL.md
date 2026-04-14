# Bloomberg

## Overview
Financial news and market data. Top news headlines, breaking news, market ticker, search, company profiles, stock charts, and market overview via Bloomberg's Next.js SSR data.

## Workflows

### Browse market news
1. `getTickerBar` → market overview (top indices, bonds, commodities with prices)
2. `getNewsHeadlines` → top 50 editorial headlines
3. `getLatestNews` → breaking/latest news feed

### Research a company
1. `searchBloomberg(query)` → results with ticker in URL (e.g. `/quote/AAPL:US`) → `ticker`
2. `getCompanyProfile(ticker)` → name, description, sector, marketCap, employees
3. `getStockChart(ticker)` → price, priceChange, open/dayHigh/dayLow, priceHistory1Y/5Y

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
| getCompanyProfile | company info | ticker <- searchBloomberg | name, description, sector, marketCap, employees | sub-page; PerimeterX may block |
| getStockChart | stock price/chart | ticker <- searchBloomberg | price, change, open/high/low, priceHistory1Y/5Y | sub-page; 15-min delayed |
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
