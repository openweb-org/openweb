# Seeking Alpha

## Overview
Investment research and analysis platform. Stock ratings, earnings data, analyst articles, and community-driven stock analysis.

## Workflows

### Research a stock
1. `searchArticles(query)` → find ticker or articles → `slug`
2. `getStockAnalysis(ticker)` → quant/author/sell-side ratings, growth/value/momentum grades, key metrics
3. `getEarnings(ticker)` → EPS/revenue estimates vs actuals, earnings call transcripts

### Read earnings transcript
1. `getEarnings(ticker)` → transcripts list → `id`
2. `getArticle(articleId)` → full transcript HTML content

### Search for analysis
1. `searchArticles(query)` → articles, symbols, news → result `id` and `url`
2. `getArticle(articleId)` → full article content (if not paywalled)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchArticles | find articles/tickers | query | id, type, name, company_name, quant_rating, url | returns symbols and articles; paginated |
| getArticle | read article content | articleId ← searchArticles or getEarnings | title, content, summary, author, tickers | some articles paywalled |
| getStockAnalysis | stock ratings & metrics | ticker | ratings (quant/author/sell-side), grades, marketcap, eps_growth | current period may be premium-locked |
| getEarnings | earnings data | ticker | estimates (EPS/revenue), transcripts list | transcript IDs feed into getArticle |

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

---

## Site Internals

### API Architecture
- REST JSON API at `seekingalpha.com/api/v3/`
- JSON:API-style responses with `data`, `included`, `meta` structure
- Metrics use numeric IDs mapped via `included` section
- Estimates API requires numeric `ticker_ids` (resolved via search API)

### Auth
No auth required for all 4 operations. Some data is premium-locked (`is_locked: true` on current-period ratings). Paywalled articles return `isPaywalled: true` with null/truncated content.

### Transport
- `transport: page` — heavy bot detection blocks Node requests
- Bot detection: Cloudflare + DataDome + Akamai + PerimeterX (all 4 systems active)
- Adapter uses `pageFetch` (browser-context fetch) for all API calls
- Dormant PerimeterX `#px-captcha` div present on all pages (cleaned up in adapter to avoid false positive)

### Known Issues
- **Premium-locked data**: Current-period quant/author ratings (`period: 0`) are locked for non-premium users. Historical periods (3/6 months ago) show full ratings.
- **Paywalled articles**: Some articles/analysis require SA Premium. `isPaywalled: true` in response.
- **Dormant PX captcha**: All SA pages contain an empty `#px-captcha` div that triggers false positive bot detection — adapter removes it post-execution.
- **Ticker ID resolution**: The estimates API needs numeric ticker IDs. `getEarnings` makes an extra API call to resolve slug → ID.
- **Metrics field naming**: The metrics API uses SA-internal numeric field IDs. Only fields with matching `included` entries are mapped.
