# IMDB

## Overview
IMDB is the world's most popular movie and TV database. Data fetched via GraphQL API (`api.graphql.imdb.com`) — no auth required. Ratings histogram from SSR fallback.

## Workflows

### Search and get movie details
1. `searchTitles(q)` → pick result → note imdbId
2. `getTitleDetail(imdbId)` → full details (plot, cast, rating, genres, runtime)

### Check ratings breakdown
1. `searchTitles(q)` → note imdbId
2. `getRatings(imdbId)` → vote histogram (1-10 breakdown)

### Get cast and crew
1. `searchTitles(q)` → note imdbId
2. `getCast(imdbId)` → directors, writers, actors

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchTitles | search movies/TV by keyword | q | imdbId, title, year, rating, genres, plot | GraphQL mainSearch |
| getTitleDetail | full title info | imdbId ← searchTitles | title, plot, runtime, genres, credits, rating | GraphQL title() |
| getRatings | ratings breakdown | imdbId ← searchTitles | aggregateRating, histogram (1-10) | GraphQL + SSR histogram |
| getCast | cast and crew | imdbId ← searchTitles | credits, actors, directors, creators | GraphQL principalCredits |

## Quick Start

```bash
# Search for movies
openweb imdb exec searchTitles '{"q": "inception"}'

# Get full title details
openweb imdb exec getTitleDetail '{"imdbId": "tt1375666"}'

# Get ratings breakdown
openweb imdb exec getRatings '{"imdbId": "tt0111161"}'

# Get cast and crew
openweb imdb exec getCast '{"imdbId": "tt0111161"}'
```

---

## Site Internals

### API Architecture
- **GraphQL API** at `api.graphql.imdb.com` — open, no auth, no signing, no bot detection from Node.js
- `title(id)` query returns full title data: text, type, year, rating, runtime, genres, plot, credits, keywords, awards
- `mainSearch(first, options: {searchTerm, type: TITLE})` returns search results with inline `... on Title` fragment
- Schema introspection blocked — field names discovered via error message suggestions
- Ratings histogram (per-rating 1-10 vote count) NOT available via GraphQL — only in `__NEXT_DATA__` SSR

### Auth
No auth required. All operations are public read-only.

### Transport
- `page` — browser required by framework for adapter execution
- 3/4 ops use `fetch()` to GraphQL API directly (zero DOM, zero page dependency)
- 1/4 ops (getRatings) uses GraphQL + `page.goto()` for histogram from `__NEXT_DATA__`

### Extraction
- **searchTitles**: GraphQL `mainSearch` → `edges[].node.entity` (Title fragment)
- **getTitleDetail**: GraphQL `title(id)` → full fields including `principalCredits`, `keywords`, `reviews`, `nominations`
- **getRatings**: GraphQL `title(id).ratingsSummary` + SSR `pageProps.contentData.histogramData.histogramValues`
- **getCast**: GraphQL `title(id).principalCredits` → category-based extraction (Stars, Director, Writers)

### Known Issues
- Cloudflare blocks Node.js HTML requests to `www.imdb.com` (returns 202) — only GraphQL API endpoint is unrestricted
- GraphQL introspection forbidden — incremental field probing required
- `principalCredits` limited to ~10 per category (top credits only)
- Histogram is the sole remaining SSR dependency — if `__NEXT_DATA__` is removed, only histogram breaks
- `prestigiousAwardSummary.wins` returns major awards only (e.g., Oscars), not all wins
