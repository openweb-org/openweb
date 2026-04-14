# NPR (National Public Radio)

## Overview
Major U.S. public media news outlet. Public Algolia search index provides full article content including text, author, date, topics, and audio availability.

## Workflows

### Search for articles on a topic
1. `searchArticles(query)` → `objectID`, `title`, `bodyText`
2. `getArticle(objectID)` → full `bodyText`, `topics`, `bylines`

### Get today's top stories
1. `getTopStories()` → `objectID`, `title`, `displayDate`
2. `getArticle(objectID)` → full `bodyText`, `topics`, `image`

### Research a topic
1. `searchArticles(query, hitsPerPage: 20)` → `objectID`, `title`, `topics`
2. Filter by topic using `filters: "type:story AND topics:\"Health\""` for section-specific results
3. `getArticle(objectID)` → full `bodyText`, `bylines`

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchArticles | find articles by keyword | query | objectID, title, bodyText, bylines, displayDate | entry point, paginated (page 0-indexed) |
| getArticle | full article content | objectID ← searchArticles/getTopStories | bodyText (full), title, bylines, topics, image | body is plain text |
| getTopStories | latest front page stories | — | objectID, title, bodyText, displayDate, topics | entry point, pre-filtered to homepage stories |

## Quick Start

```bash
# Search for articles
openweb npr exec searchArticles '{"query": "artificial intelligence"}'

# Get a specific article (use objectID from search results)
openweb npr exec getArticle '{"objectID": "nx-s1-5777587"}'

# Get latest top stories
openweb npr exec getTopStories '{}'

# Search with pagination
openweb npr exec searchArticles '{"query": "economy", "hitsPerPage": 20, "page": 1}'
```
