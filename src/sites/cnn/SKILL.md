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
