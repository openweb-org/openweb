# IMDB

## Overview
IMDB is the world's most popular movie and TV database. Data fetched via GraphQL API (`api.graphql.imdb.com`) — no auth required. Ratings histogram from SSR fallback.

## Workflows

### Search and get movie details
1. `searchTitles(q)` → `imdbId`, title, year, rating
2. `getTitleDetail(imdbId)` → full details (plot, cast, rating, genres, runtime)

### Check ratings breakdown
1. `searchTitles(q)` → `imdbId`
2. `getRatings(imdbId)` → vote histogram (1-10 breakdown)

### Get cast and crew
1. `searchTitles(q)` → `imdbId`
2. `getCast(imdbId)` → directors, writers, actors

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchTitles | search movies/TV by keyword | q | imdbId, title, year, rating, genres, plot | GraphQL mainSearch |
| getTitleDetail | full title info | imdbId ← searchTitles | title, plot, runtime, genres, credits, rating | GraphQL title() |
| getRatings | ratings breakdown | imdbId ← searchTitles | aggregateRating, histogram (1-10) | GraphQL + title page LD+JSON + SSR histogram |
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
