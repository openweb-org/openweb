# Reuters

## Overview
International news agency. News archetype — articles, topic feeds, search, financial market data via Arc Publishing (PageBuilder Fusion) API.

## Workflows

### Search and read an article
1. `searchArticles(keyword)` → results with `canonical_url`
2. `getArticle(website_url)` → full article with body paragraphs

### Browse a topic
1. `getTopicArticles(section_id)` → article list for `/world/`, `/business/`, `/technology/`, `/markets/`, `/science/`
2. `getArticle(website_url)` → full article from any result's `canonical_url`

### Check market data
1. `getMarketQuotes(rics)` → price and percent change for indices, currencies, commodities

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchArticles | search news by keyword | keyword | title, description, canonical_url, published_time | paginated (offset, size) |
| getArticle | read full article | website_url ← searchArticles or getTopicArticles | headlines, content_elements, authors, publish_date | URL path format: /section/slug/ |
| getTopicArticles | browse section feed | section_id (e.g., /world/) | articles[].title, canonical_url, published_time | paginated (offset, size); entry point |
| getMarketQuotes | get market prices | rics (e.g., .SPX,.DJI) | ric, name, last, pctChange | entry point; RIC codes |

## Quick Start

```bash
# Search for articles about technology
openweb reuters exec searchArticles '{"keyword":"technology","size":5}'

# Get a specific article
openweb reuters exec getArticle '{"website_url":"/world/us/some-article-slug-2025-01-01/"}'

# Browse world news
openweb reuters exec getTopicArticles '{"section_id":"/world/","size":10}'

# Get market quotes for major US indices
openweb reuters exec getMarketQuotes '{"rics":".SPX,.DJI,.IXIC"}'

# Get currency exchange rates
openweb reuters exec getMarketQuotes '{"rics":"EUR=,GBP=,JPY="}'
```

---

## Site Internals

## API Architecture
Reuters uses Arc Publishing's PageBuilder Fusion API at `/pf/api/v3/content/fetch/{fetcherName}`. Each fetcher accepts a JSON-encoded `query` parameter containing the actual search/filter fields. The adapter constructs this JSON from user-friendly parameters.

Key fetchers:
- `articles-by-search-v2` — keyword search
- `article-by-id-or-url-v1` — article detail by URL path
- `articles-by-section-alias-or-id-v1` — section/topic feed
- `quote-by-rics-v2` — market data by RIC codes

## Auth
No user authentication required. The API requires browser session cookies (set by initial page load) to authorize requests — direct Node.js HTTP calls return 401. The adapter uses `page.evaluate(fetch)` from the browser context.

## Transport
`page` — required because Reuters returns 401 for direct Node.js requests. The adapter makes API calls from within the browser tab using `page.evaluate(fetch(..., {credentials: 'same-origin'}))`.

## Known Issues
- **DataDome bot detection**: Reuters uses DataDome. The managed browser's real Chrome profile handles this, but the page/tab can crash after ~6-8 rapid API calls. Space out requests if making many sequential calls.
- **Market quotes RIC codes**: Common codes — indices: `.SPX`, `.DJI`, `.IXIC`, `.STOXX`, `.FTSE`, `.N225`; currencies: `EUR=`, `GBP=`, `JPY=`; commodities: `CLc1`, `GCv1`, `SIv1`.
