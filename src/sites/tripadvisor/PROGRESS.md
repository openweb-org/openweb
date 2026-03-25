# TripAdvisor Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created tripadvisor with 10 operations: searchHotels, getHotelDetail, getHotelReviews, getHotelPrices, searchRestaurants, getRestaurantDetail, getRestaurantReviews, searchAttractions, getAttractionDetail, searchAll
- Created openapi.yaml, manifest.json, DOC.md, PROGRESS.md
- Created adapters/tripadvisor-web.ts for DOM/LD+JSON extraction

**Why:**
- TripAdvisor is the largest travel reviews platform — hotel/restaurant/attraction details, reviews, and pricing are high-value operations
- No public API available; GraphQL at /data/graphql/ids uses hashed queries without stable operation names
- DataDome bot detection blocks all direct HTTP requests — browser-only access required

**Discovery process:**
1. Planned 10 target operations: search hotels/restaurants/attractions, get details, get reviews, get prices, cross-category search
2. Browsed TripAdvisor via raw CDP (Playwright's connectOverCDP crashes on shared_storage_worklet targets from Google ads)
3. Inspected page DOM and LD+JSON: found LodgingBusiness (hotels), LocalBusiness (attractions), review section with data-automation selectors
4. Identified GraphQL at /data/graphql/ids — batched queries with variables+extensions format, no operationName field
5. Built fixture manually with page transport + tripadvisor-web adapter for DOM extraction

**Verification:** Adapter created based on confirmed DOM structure; build verification pending.

**Knowledge updates:** DataDome bot detection pattern, GraphQL with hashed queries (no operationName), shared_storage_worklet causing Playwright CDP crashes on ad-heavy sites.
