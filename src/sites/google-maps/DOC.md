# Google Maps

## Overview

Google Maps — location search, place details, directions, and geocoding. Adapter-based extraction from internal APIs and SPA DOM.

## Workflows

### Find a place and get details

1. `searchPlaces(query)` → place listings → `placeId`
2. `getPlaceDetails(placeId)` → name, address, rating, hours, website, phone, reviews
3. `getPlaceReviews(placeId)` → detailed reviews with author, rating, relative time
4. `getPlacePhotos(placeId)` → photo URLs with dimensions
5. `getPlaceHours(placeId)` → weekly operating schedule
6. `getPlaceAbout(placeId)` → description, category, attributes

### Search nearby and compare

1. `nearbySearch(category, location)` → place listings → `placeId`
2. `getPlaceDetails(placeId)` per result → compare ratings, hours, prices

### Get directions between locations

1. `getDirections(origin, destination)` → driving routes with distance, duration
2. `getTransitDirections(origin, destination)` → public transit routes
3. `getWalkingDirections(origin, destination)` → walking routes
4. `getBicyclingDirections(origin, destination)` → cycling routes

### Geocoding

1. `geocode(address)` → lat, lng, placeId from address string
2. `reverseGeocode(lat, lng)` → address, place name from coordinates

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPlaces | search places by query | query | placeId, name, address, rating, lat/lng | entry point, SPA nav |
| getPlaceDetails | full place details | placeId ← searchPlaces | name, rating, hours, website, phone, reviews | preview API |
| getPlaceReviews | detailed reviews | placeId ← searchPlaces | reviews[].text, authorName, rating, relativeTime | preview API |
| getPlacePhotos | photo URLs | placeId ← searchPlaces | photos[].url, width, height | preview API |
| getPlaceHours | operating schedule | placeId ← searchPlaces | status, schedule[].day, hours | preview API |
| getPlaceAbout | description + attributes | placeId ← searchPlaces | description, category, rating, website, phone | preview API |
| getDirections | driving directions | origin, destination | routes[].name, distanceText, durationText | entry point, SPA nav |
| getTransitDirections | transit directions | origin, destination | routes[].name, durationText | entry point, SPA nav |
| getWalkingDirections | walking directions | origin, destination | routes[].name, distanceText, durationText | entry point, SPA nav |
| getBicyclingDirections | cycling directions | origin, destination | routes[].name, distanceText, durationText | entry point, SPA nav |
| nearbySearch | search by category near location | category, location | placeId, name, address, rating, lat/lng | entry point, SPA nav |
| getAutocompleteSuggestions | type-ahead suggestions | input | suggestions[].text, placeId, description | entry point, suggest API |
| geocode | address to coordinates | address | lat, lng, placeId, formattedAddress | entry point, SPA nav |
| reverseGeocode | coordinates to address | lat, lng | address, name, placeId | entry point, SPA nav |

## Quick Start

```bash
# Search for places
openweb google-maps exec searchPlaces '{"query": "coffee shops in San Francisco"}'

# Get place details (use placeId from search results)
openweb google-maps exec getPlaceDetails '{"placeId": "0x80858135f0db680b:0x47e714bf5f0080a3", "query": "The Coffee Berry SF"}'

# Get driving directions
openweb google-maps exec getDirections '{"origin": "San Francisco, CA", "destination": "Los Angeles, CA"}'

# Get transit directions
openweb google-maps exec getTransitDirections '{"origin": "Union Square, San Francisco", "destination": "Golden Gate Park, San Francisco"}'

# Search nearby
openweb google-maps exec nearbySearch '{"category": "restaurants", "location": "Times Square"}'

# Geocode an address
openweb google-maps exec geocode '{"address": "1600 Amphitheatre Parkway, Mountain View, CA"}'

# Reverse geocode coordinates
openweb google-maps exec reverseGeocode '{"lat": 37.7749, "lng": -122.4194}'
```

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.
Not needed for basic site usage.

## API Architecture

- **No public REST API** — all 14 operations use the `google-maps-api` L3 adapter
- `/internal/*` paths are virtual — the adapter handles actual data extraction
- Two extraction methods:
  - **SPA navigation + DOM**: searchPlaces, nearbySearch, getDirections (all modes), geocode, reverseGeocode — navigate to Maps URLs, extract from rendered DOM
  - **Internal API via page fetch**: getPlaceDetails, getPlaceReviews, getPlacePhotos, getPlaceHours, getPlaceAbout — `/maps/preview/place` endpoint
  - **Network intercept**: getAutocompleteSuggestions — type into search box, capture `/s?suggest=p` API response
- Place IDs are hex format (`0x...:0x...`), obtained from search results
- Internal API responses use protobuf-like nested arrays, parsed with index-based `dig()` helper

## Auth

No auth required — public pages. Transport uses `cookie_session` for session continuity across SPA navigations and internal API fetches.

## Transport

- `page` — requires Google Maps loaded in browser
- SPA navigation operations need the full Maps app initialized (generates session tokens)
- Internal API fetches use `credentials: 'include'` for session cookies
- Direction variants use URL `data=` parameter for travel mode: `!3e0` driving, `!3e1` bicycling, `!3e2` walking, `!3e3` transit

## Extraction

- **DOM extraction** (searchPlaces, nearbySearch, directions, geocode, reverseGeocode): CSS selectors on rendered SPA (`a.hfpxzc`, `.MW4etd`, `div[role="feed"]`, etc.)
- **Internal API** (getPlaceDetails, getPlaceReviews, getPlacePhotos, getPlaceHours, getPlaceAbout): `/maps/preview/place` returns nested arrays; data extracted by array index (e.g. `info[11]` = name, `info[4][7]` = rating, `info[203][1]` = hours)
- **Suggest API** (getAutocompleteSuggestions): types input into the search box, intercepts the `/s?suggest=p&tbm=map` network response, parses protobuf-like nested arrays for suggestion text, placeId, and description
- Shared `fetchPlaceInfo()` helper reused across all preview API operations

## Adapter Patterns

- `adapters/google-maps-api.ts` is a `CustomRunner` with a single `run(ctx)` entry point — no `init()` (PagePlan handles navigation) and no `isAuthenticated()` (public site, always-true was a no-op).
- Per-op handlers take `Readonly<Record<string, unknown>>` and throw plainly; the runtime handles error wrapping, and an `unknownOp` fallback in `run(ctx)` covers unmapped operations.

## Known Issues

- **Bot detection**: Google aggressively blocks automated browsers. "Sorry..." page means the IP is flagged. Requires clean browser session with organic browsing history.
- **DOM selectors**: Google Maps SPA uses obfuscated class names (`.hfpxzc`, `.MW4etd`, `.W4Efsd`) that may change without notice.
- **Internal API indices**: Preview API data is position-dependent (`info[11]` = name, `info[4][7]` = rating). Indices may shift with API updates, causing DRIFT.
- **Hours schedule**: The `getPlaceHours` schedule extraction depends on specific array indices in the preview API response; may return empty schedule if indices shift.
- **Reverse geocode**: Extraction quality depends on what Google Maps renders at the given coordinates — sparse areas may return minimal info. Verify FAIL — browser context closes before extraction completes.
- **Unverified ops**: getBicyclingDirections, getPlaceHours, getPlaceAbout, geocode lack verify examples — not tested during verify pass.
- **Flaky empty results**: SPA navigation ops (nearbySearch, directions variants) may return empty arrays under bot detection pressure. searchPlaces and getPlaceDetails are the most reliable entry points.
