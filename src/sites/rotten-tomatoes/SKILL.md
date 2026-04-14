# Rotten Tomatoes

## Overview
Movie review aggregator. Search movies, get details with Tomatometer and audience scores, cast, and synopsis.

## Workflows

### Find a movie and check scores
1. `searchMovies(query)` → `slug`, `title`, `tomatometerScore`, `isCertifiedFresh`
2. `getMovieDetail(slug)` → `synopsis`, `audienceScore`, `cast`, `directors`, `genre`

### Quick Tomatometer lookup
1. `searchMovies(query)` → `slug`
2. `getTomatoMeter(slug)` → `tomatometer.score`, `isCertifiedFresh`, `audienceScore.score`

### Compare movies
1. `searchMovies(query)` → `slug` values for each movie
2. `getTomatoMeter(slug)` for each → compare `tomatometer.score`, `audienceScore.score`

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchMovies | search for movies | query | title, slug, year, tomatometerScore, isCertifiedFresh, cast | entry point, movies only (filters out TV/celebrity) |
| getMovieDetail | full movie details | slug ← searchMovies | title, synopsis, tomatometerScore, audienceScore, cast, directors, genre | LD+JSON + scorecard HTML parsing |
| getTomatoMeter | scores only | slug ← searchMovies | tomatometer.score, isCertifiedFresh, audienceScore.score | lightweight score-focused view |

## Quick Start

```bash
# Search for a movie
openweb rotten-tomatoes exec searchMovies '{"query":"inception"}'

# Get movie details by slug
openweb rotten-tomatoes exec getMovieDetail '{"slug":"inception"}'

# Get just the Tomatometer scores
openweb rotten-tomatoes exec getTomatoMeter '{"slug":"inception"}'
```
