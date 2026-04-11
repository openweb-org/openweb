# Rotten Tomatoes

## Overview
Movie review aggregator. Search movies, get details with Tomatometer and audience scores, cast, and synopsis.

## Workflows

### Find a movie and check scores
1. `searchMovies(query)` → browse results → pick `slug`
2. `getMovieDetail(slug)` → title, synopsis, Tomatometer, audience score, cast, directors

### Quick Tomatometer lookup
1. `getTomatoMeter(slug)` → Tomatometer score, certified fresh status, audience score

### Compare movies
1. `searchMovies(query)` → note `slug` values from results
2. `getTomatoMeter(slug)` for each → compare scores

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchMovies | search for movies | query | title, slug, year, tomatometerScore, isCertifiedFresh, cast | entry point, movies only (filters out TV/celebrity) |
| getMovieDetail | get full movie details | slug ← searchMovies | title, synopsis, tomatometerScore, audienceScore, cast, directors, genre | LD+JSON + scorecard HTML parsing |
| getTomatoMeter | get scores only | slug ← searchMovies | tomatometer (score, sentiment, reviewCount), audienceScore (score, sentiment) | lightweight score-focused view |

## Quick Start

```bash
# Search for a movie
openweb rotten-tomatoes exec searchMovies '{"query":"inception"}'

# Get movie details by slug
openweb rotten-tomatoes exec getMovieDetail '{"slug":"inception"}'

# Get just the Tomatometer scores
openweb rotten-tomatoes exec getTomatoMeter '{"slug":"inception"}'
```

---

## Site Internals

### API Architecture
- No public API — all data is server-rendered HTML (SSR)
- Search results use `search-page-media-row` custom web components with data in element attributes
- Movie detail pages embed LD+JSON (schema.org Movie) and use `media-scorecard` web components for scores
- All data extractable via plain HTTP fetch + HTML parsing — no browser rendering needed
- `__RT__` global exists but contains only feature flags and utility functions, not data

### Auth
- No auth required — all operations are publicly accessible
- `requires_auth: false`

### Transport
- `page` transport with adapter — but adapter uses Node.js native `fetch()` internally
- No DOM dependency: parses raw SSR HTML (element attributes + LD+JSON + scorecard slots)
- No bot detection observed — pure node fetch returns full SSR HTML
- No webpack, no patched fetch, no client-side signing

### Extraction
- **Search:** HTML attributes from `search-page-media-row` elements (tomatometer-score, release-year, cast, etc.)
- **Detail:** LD+JSON for structured data (cast, director, rating, genre) + `media-scorecard` score slots in HTML
- **Scores:** `media-scorecard` HTML with `score-icon-critics` and `score-icon-audience` attributes + slot content

### Known Issues
- Search returns only the first page of results (no pagination API discovered)
- Movie slugs are not always predictable — use `searchMovies` to discover slugs
- Some older or lesser-known movies may lack Tomatometer scores (attributes present but empty)
