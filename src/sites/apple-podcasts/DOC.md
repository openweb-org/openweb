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

---

## Site Internals

## API Architecture
REST API at `amp-api.podcasts.apple.com`. Apple's internal content API used by the web player. JSON:API-style responses with `data`, `included`, and `relationships` structure.

## Auth
- MusicKit developer JWT extracted from `window.MusicKit.getInstance().developerToken`
- Token is a public developer-level JWT (ES256), not per-user auth
- Injected as `Authorization: Bearer <token>` by the adapter
- Token is rotated periodically (weeks-scale expiry)

## Transport
- `page` transport with adapter (`apple-podcasts-api.ts`)
- Adapter uses `page.request.fetch()` to call `amp-api.podcasts.apple.com` with the bearer token
- Browser must have a podcasts.apple.com tab open for MusicKit token access

## Known Issues
- `platform=web` query param is required on search and editorial endpoints
- The `extend` and `include` bracket-style params (e.g., `extend[podcast-channels]`) use Apple's custom query encoding
- No dedicated episodes-only endpoint captured; use `getPodcast` with `include=episodes` and `limit[episodes]` param
