# BBC News

## Overview
Global news — the BBC's public news service covering world, UK, business, technology, sport, and more.

## Workflows

### Browse headlines
1. `getHeadlines` → top stories with title, description, url, topic

### Read an article
1. `getHeadlines` or `searchArticles` → pick story → extract `articleId` from url
2. `getArticle(articleId)` → full article with title, body, publishedAt, byline, topics

### Search news
1. `searchArticles(q)` → matching articles with title, description, url

### Browse by topic
1. `getTopicFeed(topic)` → articles for a topic (world, business, innovation, culture, arts, travel)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getHeadlines | top stories | — | title, description, url, topic, isLive | entry point |
| getArticle | read full article | articleId ← url from getHeadlines | title, body, byline, publishedAt, topics | |
| searchArticles | search news | q | title, description, url | paginated |
| getTopicFeed | browse topic | topic | title, description, url, topic | world, business, innovation, culture, arts, travel |

## Quick Start

```bash
# Get top headlines
openweb bbc-news exec getHeadlines '{}'

# Read a specific article (articleId from url path)
openweb bbc-news exec getArticle '{"articleId": "c62l597wl0yo"}'

# Search articles
openweb bbc-news exec searchArticles '{"q": "climate change"}'

# Get world news
openweb bbc-news exec getTopicFeed '{"topic": "world"}'
```

---

## Site Internals

## API Architecture
- Next.js SSR site — all data in `__NEXT_DATA__` script tag
- Homepage and topic pages: `pageProps.page → sections[] → content[]` (article listings)
- Article pages: `pageProps.page → contents[]` (nested block model with headline, byline, timestamp, text, image)
- Search pages: `pageProps.page → results[]`
- Page key pattern: `@"news",` (homepage), `@"news","articles","{id}",` (article), `/search?terms={q}&page={n}` (search)

## Auth
No auth required (public news site).

## Transport
`page` — Cloudflare bot detection (`cf_clearance` cookies) blocks direct HTTP. All operations use `page_global_data` extraction from `__NEXT_DATA__`.

## Extraction
- **getHeadlines/getTopicFeed**: Flatten all `sections[].content[]` arrays, skip ads, deduplicate by id
- **getArticle**: Traverse nested block model (`contents[]`) — headline, byline, timestamp blocks parsed separately; text blocks extracted via recursive paragraph finder
- **searchArticles**: Direct extraction from `results[]` array in search page data

## Known Issues
- Some BBC topic URLs redirect (e.g., `/news/technology` → `/technology`). Supported topics: world, business, innovation, culture, arts, travel
- Sport (`/news/sport`) uses a different system without `__NEXT_DATA__` — not supported via this extraction
- Article URLs from headlines may be relative (`/news/articles/...`) or absolute (`https://www.bbc.com/...`)
- `lastUpdated` timestamps are Unix milliseconds
