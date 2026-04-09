# IMDB

## Overview
IMDB is the world's most popular movie and TV database. All data extracted from SSR (`__NEXT_DATA__` and LD+JSON) — no public API.

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
| searchTitles | search movies/TV by keyword | q | imdbId, title, year, rating, genres, plot | entry point |
| getTitleDetail | full title info | imdbId ← searchTitles | title, plot, runtime, genres, credits, rating | SSR extraction |
| getRatings | ratings breakdown | imdbId ← searchTitles | aggregateRating, histogram (1-10) | separate page |
| getCast | cast and crew | imdbId ← searchTitles | credits, actors, directors, creators | SSR + LD+JSON |

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
- No public JSON API — IMDB uses Next.js SSR with `__NEXT_DATA__` embedded in every page
- `__NEXT_DATA__` contains `aboveTheFoldData` (title, rating, genres, credits, plot) and `mainColumnData` (reviews, awards, ratings breakdown)
- LD+JSON (`application/ld+json`) provides schema.org Movie/TVSeries data with actor/director lists
- Search results are in `__NEXT_DATA__` → `pageProps.titleResults.results`
- Ratings page has `contentData.histogramData.histogramValues` for vote distribution
- GraphQL API exists at `api.graphql.imdb.com` (persisted queries) but SSR extraction is simpler and more stable

### Auth
No auth required. All operations are public read-only.

### Transport
- `page` — browser required (Cloudflare `cf_clearance` cookies present)
- All 4 ops use the adapter (`adapters/imdb.ts`) for SSR extraction via `page.goto()` + `page.evaluate()`
- `domcontentloaded` wait strategy with 3s hydration wait

### Extraction
- **searchTitles**: `__NEXT_DATA__` → `pageProps.titleResults.results[].listItem`
- **getTitleDetail**: `__NEXT_DATA__` → `pageProps.aboveTheFoldData` + `mainColumnData`
- **getRatings**: `__NEXT_DATA__` → `pageProps.contentData.histogramData`
- **getCast**: `__NEXT_DATA__` → `pageProps.aboveTheFoldData.principalCreditsV2` + LD+JSON actors/directors

### Known Issues
- Cloudflare bot detection — requires headed browser with valid session
- `__NEXT_DATA__` is large (~700KB on title pages), extraction is fast since it's parsed once
- Search results limited to ~25 per page (no pagination param exposed)
- Cast from `__NEXT_DATA__` is limited to principal credits (top 3 per category); LD+JSON provides more actors
- Runtime is in seconds in raw data, converted to minutes in output
