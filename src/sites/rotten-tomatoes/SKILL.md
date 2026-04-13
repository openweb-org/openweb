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
