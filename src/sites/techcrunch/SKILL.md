# TechCrunch

## Overview
Leading tech news outlet covering startups, venture capital, AI, and technology. Built on WordPress with a public WP REST API at techcrunch.com/wp-json/wp/v2/.

## Workflows

### Search for articles on a topic
1. `searchArticles(search)` → browse results → note post `id`
2. `getArticle(id)` → full article with body, author, date

### Get the latest tech news
1. `getLatest()` → most recent articles across all categories
2. `getArticle(id)` → drill into a specific article for full content

### Browse articles by category
1. `getCategory(categories)` → articles in a category (AI, Startups, Venture, etc.)
2. `getArticle(id)` → full article content

### Research a topic across categories
1. `searchArticles(search, orderby: date)` → recent coverage sorted by date
2. `getCategory(categories)` → compare coverage across categories

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchArticles | find articles by keyword | search | id, title, excerpt, date, link | entry point, paginated |
| getArticle | full article content | id ← searchArticles/getLatest/getCategory | content.rendered, title, date, _embedded.author | body is HTML |
| getLatest | latest articles | — | id, title, excerpt, date, link | entry point, date desc |
| getCategory | articles in a category | categories (ID) | id, title, excerpt, date, link | entry point, common IDs in param description |

## Quick Start

```bash
# Search for articles
openweb techcrunch exec searchArticles '{"search": "artificial intelligence"}'

# Get a specific article (use id from search results)
openweb techcrunch exec getArticle '{"id": 3110945}'

# Get latest articles
openweb techcrunch exec getLatest '{}'

# Get AI category articles (category ID 577030455)
openweb techcrunch exec getCategory '{"categories": 577030455}'
```
