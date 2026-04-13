# Apple Podcasts

## Overview
Apple Podcasts content platform — search, browse, and get details for podcasts and episodes via the AMP API.

## Workflows

### Search and explore a podcast
1. `searchPodcasts(term)` → results with podcast `id`
2. `getPodcast(id, include=["episodes"])` → full details with episode list

### Autocomplete search
1. `getSearchSuggestions(term)` → suggestions with podcast/episode matches
2. `searchPodcasts(term)` → full search results

### Browse top charts
1. `getTopCharts(name="search-landing")` → editorial groupings with featured podcasts

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPodcasts | search by keyword | term | id, name, artistName, artwork, url | entry point |
| getPodcast | podcast detail + episodes | id ← searchPodcasts | name, description, artwork, feedUrl, genreNames, episodes (via include) | set include=episodes for episode list |
| getSearchSuggestions | autocomplete | term | searchTerm, displayTerm, content | prefix-based suggestions |
| getTopCharts | browse charts | name (optional) | editorial groupings, featured podcasts | name=search-landing for main charts |

## Quick Start

```bash
# Search podcasts
openweb apple-podcasts exec searchPodcasts '{"term":"technology"}'

# Get podcast details with episodes
openweb apple-podcasts exec getPodcast '{"id":"917918570","extend":["editorialArtwork","feedUrl","userRating"],"include":["episodes"],"limit[episodes]":10}'

# Autocomplete suggestions
openweb apple-podcasts exec getSearchSuggestions '{"term":"tech"}'

# Top charts
openweb apple-podcasts exec getTopCharts '{"name":"search-landing"}'
```
