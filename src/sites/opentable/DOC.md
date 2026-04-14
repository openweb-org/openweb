# OpenTable

## Overview
Restaurant reservation platform — search restaurants, view details and reviews, check reservation availability. Commerce archetype.

## Workflows

### Find and book a restaurant
1. `searchRestaurants(term, location)` → restaurant list with `restaurantId`, `slug`
2. `getRestaurant(slug)` → full details (hours, cuisine, ratings, address)
3. `getAvailability(restaurantId, date, time, partySize)` → available time slots

### Read restaurant reviews
1. `searchRestaurants(term, location)` → pick restaurant → `restaurantId`
2. `getReviews(restaurantId, page)` → paginated reviews (10/page)

### Search with availability
1. `searchRestaurants(term, location, date, time, covers)` → restaurants in the area
2. `getAvailability(restaurantId, date, time, partySize)` → time slots for specific restaurant

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchRestaurants | find restaurants | term, location | restaurantId, name, slug, cuisine, rating, neighborhood | entry point; adapter (browser) |
| getRestaurant | restaurant details | slug ← searchRestaurants | name, cuisine, ratings, hours, address, description, photos | adapter (browser) |
| getAvailability | check time slots | restaurantId ← searchRestaurants, date, time, partySize | slots with timeOffsetMinutes, seatingTypes | GraphQL via page |
| getReviews | customer reviews | restaurantId ← searchRestaurants, page | reviewId, rating, text, displayName, dinedDate | paginated (10/page); GraphQL via page |

## Quick Start

```bash
# Search for Italian restaurants in San Francisco
openweb opentable exec searchRestaurants '{"term": "italian", "location": "San Francisco"}'

# Get restaurant details
openweb opentable exec getRestaurant '{"slug": "ceron-kitchen-alameda"}'

# Check availability for 2 people
openweb opentable exec getAvailability '{"restaurantId": 1204381, "date": "2027-01-15", "time": "19:00", "partySize": 2}'

# Read reviews (page 1, newest first)
openweb opentable exec getReviews '{"restaurantId": 1204381, "page": 1}'
```

---

## Site Internals

### API Architecture
- Apollo GraphQL at `/dapi/fe/gql` with persisted queries (sha256 hashes)
- Search results delivered via SSR in `__INITIAL_STATE__.multiSearch.restaurants`
- Restaurant details via SSR in `__INITIAL_STATE__.restaurantProfile.restaurant`
- Availability and reviews fetched via GraphQL persisted queries (`RestaurantsAvailability`, `ReviewSearchResults`)
- Availability GQL requires `ot-page-group` / `ot-page-type` headers

### Auth
No auth required. All operations are public read. CSRF token (`window.__CSRF_TOKEN__`) required for GraphQL calls — extracted automatically by adapter.

### Transport
- All operations: page (browser via `opentable` adapter)
- Akamai bot detection (`_abck` cookie) blocks direct HTTP
- Search/detail: page navigation + SSR extraction from `__INITIAL_STATE__`
- Availability/reviews: browser-context `fetch()` to GraphQL endpoint with CSRF token

### Extraction
- Search/detail: SSR state from `window.__INITIAL_STATE__` (multiSearch.restaurants, restaurantProfile.restaurant)
- Availability/reviews: JSON from GraphQL persisted query responses

### Known Issues
- Akamai bot detection requires page transport — node transport will fail
- GraphQL persisted query hashes rotate across deployments — stale hashes return HTTP 409 "Conflict" (not standard APQ PersistedQueryNotFound). Re-capture from live site network traffic
- Search returns up to 50 restaurants per page; no direct pagination API — page 2 requires URL navigation
- `getAvailability` slot times are offsets from the requested time (e.g. -30 = 30 min earlier)
