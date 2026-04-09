# Yelp

## Overview
Local business discovery platform — search businesses, autocomplete suggestions, read reviews. Commerce archetype.

## Workflows

### Search for local businesses
1. `autocompleteBusinesses(prefix, loc)` → suggestions with `query`
2. `searchBusinesses(find_desc, find_loc)` → business list with `name`, `rating`, `address`

### Browse by location
1. `searchBusinesses(find_desc, find_loc)` → results with `bizId`, `alias`, `categories`
2. Paginate with `start` param (10 results per page)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| autocompleteBusinesses | typeahead suggestions | prefix, loc | title, query, subtitle, type | entry point; node transport |
| searchBusinesses | search businesses by keyword + location | find_desc, find_loc | name, rating, reviewCount, categories, address | entry point; adapter (browser); paginated (start) |

## Quick Start

```bash
# Autocomplete suggestions
openweb yelp exec autocompleteBusinesses '{"prefix": "piz", "loc": "San Francisco, CA"}'

# Search for businesses
openweb yelp exec searchBusinesses '{"find_desc": "pizza", "find_loc": "San Francisco, CA"}'

# Paginate search results (page 2)
openweb yelp exec searchBusinesses '{"find_desc": "pizza", "find_loc": "San Francisco, CA", "start": 10}'
```

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.
Not needed for basic site usage.

### API Architecture
- `autocompleteBusinesses` hits a JSON API at `/search_suggest/v2/prefetch` — works via direct HTTP (node transport)
- `searchBusinesses` loads the search results page and extracts data via a custom adapter — dual extraction from SSR JSON (`<script type="application/json">`) with DOM fallback (`[data-testid="serp-ia-card"]`)
- Search results include both organic results and ads (marked with `isAd: true`)

### Auth
No auth required. All operations are public read.

### Transport
- `autocompleteBusinesses`: node (direct HTTP)
- `searchBusinesses`: page (browser via `yelp-web` adapter) — Yelp blocks direct HTTP for search pages

### Extraction
- **searchBusinesses**: SSR JSON extraction from large `<script type="application/json">` blocks, merged with DOM fallback from `[data-testid="serp-ia-card"]` elements. Ad results are detected via redirect URLs and handled separately.

### Known Issues
- `searchBusinesses` requires browser transport (page) — Yelp blocks direct node HTTP for search result pages
- SSR JSON structure may change across Yelp deployments; DOM fallback provides resilience
- Ad results use redirect URLs; the adapter resolves these to extract the actual business alias
