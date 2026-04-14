# Seeking Alpha

## Overview
Investment research and analysis platform. Stock ratings, earnings data, analyst articles, and community-driven stock analysis.

## Workflows

### Research a stock
1. `searchArticles(query)` → `slug`, `quant_rating`
2. `getStockAnalysis(ticker)` → `ratings` (quant/author/sell-side), `grades`, `metrics`
3. `getEarnings(ticker)` → `estimates` (EPS/revenue), `transcripts`

### Read earnings transcript
1. `getEarnings(ticker)` → `transcripts[].id`
2. `getArticle(articleId)` → full transcript HTML content

### Search for analysis
1. `searchArticles(query)` → `id`, `url`, `type`
2. `getArticle(articleId)` → full article content (if not paywalled)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchArticles | find articles/tickers | query | id, type, name, company_name, quant_rating, url | returns symbols and articles; paginated |
| getArticle | read article content | articleId ← searchArticles or getEarnings `transcripts[].id` | title, content, summary, author, tickers | some articles paywalled |
| getStockAnalysis | stock ratings & metrics | ticker | ratings (quant/author/sell-side), grades, marketcap, eps_growth | entry point; current period may be premium-locked |
| getEarnings | earnings data | ticker | estimates (EPS/revenue), transcripts[].id | entry point; transcript IDs feed into getArticle |

## Quick Start

```bash
# Search for Apple articles
openweb seeking-alpha exec searchArticles '{"query":"AAPL","size":5}'

# Read an article/transcript
openweb seeking-alpha exec getArticle '{"articleId":"4864181"}'

# Stock analysis: ratings, grades, metrics
openweb seeking-alpha exec getStockAnalysis '{"ticker":"AAPL"}'

# Earnings: estimates vs actuals + transcript list
openweb seeking-alpha exec getEarnings '{"ticker":"AAPL"}'
```
