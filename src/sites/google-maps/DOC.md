# Google Maps

## Overview
Google Maps — place search, place details, reviews, photos, directions, nearby search, and autocomplete. Adapter-based extraction from internal APIs and SPA DOM.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchPlaces | search places by query | GET /internal/searchPlaces | SPA nav + DOM extraction |
| getPlaceDetails | full place details | GET /internal/getPlaceDetails | preview API via page fetch |
| getPlaceReviews | detailed place reviews | GET /internal/getPlaceReviews | preview API, author + rating per review |
| getPlacePhotos | place photo URLs | GET /internal/getPlacePhotos | preview API, direct image URLs |
| getDirections | driving directions | GET /internal/getDirections | SPA nav + DOM extraction |
| nearbySearch | search by category near location | GET /internal/nearbySearch | SPA nav, "category near location" pattern |
| getAutocompleteSuggestions | type-ahead suggestions | GET /internal/getAutocompleteSuggestions | suggest API via page fetch |

## API Architecture
- **No public REST API** — all operations use `google-maps-api` adapter (L3)
- `/internal/*` paths are virtual — the adapter handles actual data extraction
- Two extraction methods:
  - **SPA navigation + DOM**: searchPlaces, nearbySearch, getDirections — navigate to Maps URLs, extract from rendered DOM
  - **Internal API via page fetch**: getPlaceDetails, getPlaceReviews, getPlacePhotos — `/maps/preview/place` endpoint; getAutocompleteSuggestions — `/maps/suggest` endpoint
- Place IDs are hex format (`0x...:0x...`), obtained from search results
- Internal API responses use protobuf-like nested arrays, parsed with index-based `dig()` helper

## Auth
None — public pages.

## Transport
- `page` — requires Google Maps loaded in browser
- SPA navigation operations need the full Maps app initialized (generates session tokens)
- Internal API fetches use `credentials: 'include'` for session cookies

## Extraction
- **DOM extraction** (searchPlaces, nearbySearch, getDirections): CSS selectors on rendered SPA (`a.hfpxzc`, `.MW4etd`, `div[role="feed"]`, etc.)
- **Internal API** (getPlaceDetails, getPlaceReviews, getPlacePhotos): `/maps/preview/place` returns nested arrays; data extracted by array index
- **Suggest API** (getAutocompleteSuggestions): `/maps/suggest` returns JSON with suggestion entries
- Shared `fetchPlaceInfo()` helper avoids duplicate API calls across detail/review/photo operations

## Known Issues
- **Bot detection**: Google aggressively blocks automated browsers. "Sorry..." page means the IP is flagged. Requires clean browser session with organic browsing history.
- **DOM selectors**: Google Maps SPA uses obfuscated class names (`.hfpxzc`, `.MW4etd`, `.W4Efsd`) that may change without notice.
- **Internal API indices**: Preview API data is position-dependent (`info[11]` = name, `info[4][7]` = rating). Indices may shift with API updates.

## Dependencies
- `searchPlaces` / `nearbySearch` -> `getPlaceDetails`: placeId from search results
- `searchPlaces` / `nearbySearch` -> `getPlaceReviews`: placeId from search results
- `searchPlaces` / `nearbySearch` -> `getPlacePhotos`: placeId from search results
