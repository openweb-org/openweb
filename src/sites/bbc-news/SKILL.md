# BBC News

## Overview
Global news — the BBC's public news service covering world, UK, business, technology, sport, and more.

## Workflows

### Browse headlines
1. `getHeadlines` → top stories with title, description, url, topic

### Read an article
1. `getHeadlines` or `searchArticles(q)` → `url` (contains `articleId` in path)
2. `getArticle(articleId)` → `title`, `body`, `publishedAt`, `byline`, `topics`

### Search news
1. `searchArticles(q)` → `title`, `description`, `url`

### Browse by topic
1. `getTopicFeed(topic)` → `title`, `description`, `url`, `topic`

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getHeadlines | top stories | — | title, description, url, topic, isLive | entry point |
| getArticle | read full article | articleId <- getHeadlines/searchArticles `url` | title, body, byline, publishedAt, topics | |
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
