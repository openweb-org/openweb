# Reuters

## Overview
International news agency. News archetype — search articles, browse topic feeds, read full articles, and get top/breaking news via Arc Publishing (PageBuilder Fusion) API.

## Workflows

### Search news
1. `searchArticles(keyword)` → articles with title, description, canonical_url

### Browse a topic
1. `getTopicArticles(section_id)` → article list for `/world/`, `/business/`, `/technology/`, `/markets/`, `/science/`

### Read full article
1. `searchArticles(keyword)` or `getTopicArticles(section_id)` or `getTopNews()` → `canonical_url`
2. `getArticleDetail(article_url=canonical_url)` → full article with `title`, `body`, `authors`, `section`, `word_count`

### Top news
1. `getTopNews()` → top/breaking news stories from the Reuters homepage feed

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchArticles | search news by keyword | keyword | title, description, canonical_url, published_time | entry point; paginated (offset, size) |
| getTopicArticles | browse section feed | section_id (e.g., /world/) | title, description, canonical_url, published_time | entry point; paginated (offset, size) |
| getArticleDetail | read full article | article_url ← searchArticles / getTopicArticles / getTopNews | title, body, authors, section, published_time, word_count | extracts from Fusion SSR or DOM fallback |
| getTopNews | top/breaking news | (none) | title, description, canonical_url, published_time | homepage section feed; optional size param |

## Quick Start

```bash
# Search for articles about technology
openweb reuters exec searchArticles '{"keyword":"technology","size":5}'

# Browse world news
openweb reuters exec getTopicArticles '{"section_id":"/world/","size":5}'

# Read a specific article (use canonical_url from search/topic results)
openweb reuters exec getArticleDetail '{"article_url":"/technology/cybersecurity/example-article-2025-04-01/"}'

# Get top/breaking news
openweb reuters exec getTopNews '{"size":10}'
```

### Common Section IDs

| Section | section_id |
|---------|------------|
| World | /world/ |
| Business | /business/ |
| Technology | /technology/ |
| Markets | /markets/ |
| Science | /science/ |
| Sports | /sports/ |
| Sustainability | /sustainability/ |
