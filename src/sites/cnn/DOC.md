# CNN

## Overview
Major US cable news network. CNN.com provides breaking news, analysis, and video content across politics, world, business, health, entertainment, and more.

## Workflows

### Search and read an article
1. `searchArticles(q)` → browse results → note article URL path
2. `getArticle(slug)` → full article with title, body, author, date

### Browse top headlines then drill into a story
1. `getHeadlines` → current front-page stories with titles and URLs
2. `getArticle(slug)` → full article content (strip leading `/` from URL)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getHeadlines | top stories / front page | — | title, url, contentType | entry point, ~75 items |
| getArticle | full article content | slug ← getHeadlines.url | title, body, author, publishedAt, section | body is plain text via LD+JSON |
| searchArticles | find articles by keyword | q | title, url, description, date | paginated, ~10 per page |

## Quick Start

```bash
# Get front-page headlines
openweb cnn exec getHeadlines '{}'

# Get a specific article (use slug from headlines or search)
openweb cnn exec getArticle '{"slug": "2026/04/07/weather/super-el-nino-extreme-weather-climate-disaster"}'

# Search for articles
openweb cnn exec searchArticles '{"q": "climate change"}'
```

---

## Site Internals

## API Architecture
- SSR-rendered site — no public content API, no `__NEXT_DATA__`
- Headlines and search results are in the DOM (card components)
- Article content is in structured LD+JSON (`@type: NewsArticle`)
- Internal search API at `search.prod.di.api.cnn.io/content` (CORS-restricted, used by page JS)
- `CNN.contentModel` window global has page metadata but not article body

## Auth
No auth required for reading public content.

## Transport
`page` — heavy bot detection (Cloudflare + DataDome + PerimeterX). Node transport would fail. All operations use browser-based page extraction.

## Extraction
- **getHeadlines**: DOM extraction from `[data-component-name="card"]` elements
- **getArticle**: LD+JSON extraction (`script[type="application/ld+json"]` with `@type: NewsArticle`)
- **searchArticles**: DOM extraction with async polling (search results load via XHR after page load)

## Known Issues
- Search results are loaded via XHR — extraction polls for up to 8 seconds
- Article slug must not include leading `/` — use path portion only
- Some headline cards have short/teaser titles vs full article headlines
- `contentType` on headlines reflects link type (article, live-story, video, card)
