# Google Search

## Overview
Search engine (archetype: search). Google.com — autocomplete suggestions, organic web/image/news/video/shopping results, local business pack, knowledge panel, People Also Ask, and related searches via page DOM extraction.

## Workflows

### Research a topic with context
1. `searchSuggestions(q)` → `completions[]` for query refinement
2. `searchWeb(q)` → `title`, `link`, `snippet` per result
3. `getPeopleAlsoAsk(q)` → `questions[]` for deeper exploration
4. `getRelatedSearches(q)` → `searches[]` for follow-up queries

### Compare products
1. `searchSuggestions(q)` → `completions[]` to refine product search terms
2. `searchShopping(q)` → `title`, `price`, `merchant`, `reviewCount`
3. `searchWeb(q)` → `title`, `link`, `snippet` for review articles

### Get entity information
1. `searchWeb(q)` → `title`, `link`, `snippet` for entity name
2. `getKnowledgePanel(q)` → `title`, `subtitle`, `description`, `facts[]`

### Find local businesses
1. `searchLocal(q)` → `name`, `rating`, `reviews`, `type`, `address`
2. `searchWeb(q)` → supplementary `title`, `link`, `snippet` results

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchSuggestions | autocomplete completions | q, client=chrome | completion strings | entry point, node transport |
| searchWeb | organic web results | q | title, link, displayUrl, snippet | entry point, page extraction |
| searchImages | image results | q | sourceUrl, alt, width, height | page, navigate with udm=2 |
| searchNews | news articles | q | title, link, source, snippet, publishedAt | page, navigate with tbm=nws |
| searchVideos | video results | q | title, link, source, snippet | page, navigate with tbm=vid |
| searchShopping | product listings | q | title, price, originalPrice, merchant, reviewCount | page, navigate with udm=28 |
| getKnowledgePanel | entity facts | q (entity name) | title, subtitle, description, facts[] | page, entity queries only |
| getPeopleAlsoAsk | related questions | q | questions[], count | page, from PAA box |
| getRelatedSearches | follow-up queries | q | searches[], count | page, from page bottom |
| searchLocal | local businesses | q (location query) | name, rating, reviews, type, address | page, map pack results |

## Quick Start

```bash
# Autocomplete suggestions (node transport, no browser needed)
openweb google-search exec searchSuggestions '{"q": "best laptop", "client": "chrome"}'

# Web search results (requires browser with google.com open)
openweb google-search exec searchWeb '{"q": "best laptop 2025"}'

# Image search
openweb google-search exec searchImages '{"q": "aurora borealis"}'

# News search
openweb google-search exec searchNews '{"q": "technology"}'

# Shopping results
openweb google-search exec searchShopping '{"q": "wireless headphones"}'

# Knowledge panel for an entity
openweb google-search exec getKnowledgePanel '{"q": "Albert Einstein"}'

# People Also Ask
openweb google-search exec getPeopleAlsoAsk '{"q": "what is python"}'

# Related searches
openweb google-search exec getRelatedSearches '{"q": "machine learning"}'

# Local businesses
openweb google-search exec searchLocal '{"q": "coffee shops near times square"}'
```
