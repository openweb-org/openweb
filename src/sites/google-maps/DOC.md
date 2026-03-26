# Google Maps

## Overview
Google Maps — place search, place details, and driving directions. Adapter-based extraction from internal APIs.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchPlaces | search places by query | GET /internal/searchPlaces | adapter: google-maps-api |
| getPlaceDetails | full place details | GET /internal/getPlaceDetails | placeId from searchPlaces |
| getDirections | driving directions | GET /internal/getDirections | origin + destination |

## API Architecture
- **No public REST API** — all operations use `google-maps-api` adapter to extract from internal preview APIs
- `/internal/*` paths are virtual — the adapter handles actual data extraction
- Place IDs are hex format (`0x...:0x...`), obtained from search results
- Returns rich data: ratings, reviews, hours, website, phone, coordinates, route distances/durations

## Auth
None — public pages.

## Transport
- `page` — requires Google Maps loaded in browser

## Dependencies
- `searchPlaces` → `getPlaceDetails`: placeId from search results feeds into detail lookup
