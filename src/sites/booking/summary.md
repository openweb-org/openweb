# Booking.com — Discovery & Implementation

## Final Architecture

- **searchHotels**: Apollo SSR cache extraction from inline `<script type="application/json">` — zero DOM selectors
- **getHotelDetail**: LD+JSON `@type: Hotel` schema — zero DOM (unchanged, already stable)
- **getHotelReviews**: GraphQL `page.evaluate(fetch('/dml/graphql'))` with `ReviewScoresQuery` — zero DOM
- **getHotelPrices**: GraphQL `page.evaluate(fetch('/dml/graphql'))` with `RoomDetailQuery` — zero DOM
- **searchFlights**: DOM extraction (flights API returns 403 — no alternative found)
- **Transport**: `page` — PerimeterX bot detection blocks node fetch
- **5 operations** (all read), 3/5 upgraded from DOM to structured data extraction

## Discovery Journey

### Phase 1: Network Probe

Navigated to booking.com search, hotel detail, and flights pages with headed browser. Captured all network requests via CDP.

**GraphQL endpoint confirmed**: `https://www.booking.com/dml/graphql?lang=en-us`
- Hotel search page fires 5 GraphQL queries: `staticGoogleMapUrlBff`, `LandmarksByUfi`, `wishlistsDetailForWishlistWidget`, `GetXMSurveyCampaignByRegionId`, `DismissGeniusSignInSheet`
- Hotel detail page fires 8 GraphQL queries including `PropertySurroundingsBlockDesktop`, `PropertyFaq`, `SuggestedTopicQuestions`, `userWishlistsForHotel`, `RoomPageDesktopRDS` (80KB response with review scores + room details)
- Flights page fires REST API at `flights.booking.com/api/flights/` — but returns 403 "Not authorized"

### Phase 2: Environment Probes

**Fetch**: NOT patched — `window.fetch.toString()` is 34 chars (`function fetch() { [native code] }`). No client-side signing. `page.evaluate(fetch(...))` works cleanly.

**Webpack**: No standard webpack chunks on hotel detail pages. Search page has `b-search-web-searchresults__LOADABLE_LOADED_CHUNKS__` but not useful for our purposes.

**Global variables**: `window.booking` object with keys: `env` (contains `b_hotel_id`, `b_dest_id`), `hotel`, `Search`, etc. The `booking.env.b_hotel_id` is used to resolve hotel IDs for GraphQL queries.

**LD+JSON**: `@type: Hotel` schema present on detail pages — confirmed stable with name, aggregateRating, description, address, image.

### Phase 3: Apollo SSR Cache Discovery

**Key find**: Search results page embeds a 512KB `<script type="application/json">` containing the full Apollo Client SSR cache.

Structure: `ROOT_QUERY.searchQueries.search({...}).results[]` — array of `SearchResultProperty` objects with:
- `displayName.text` — hotel name
- `basicPropertyData.{id, location.{address, city, countryCode, latitude, longitude}, pageName, reviews.{totalScore, reviewsCount, totalScoreTextTag.translation}, starRating}`
- `priceDisplayInfoIrene.{averagePricePerNight.{amount, currency}, displayPrice, priceBeforeDiscount, discounts[]}`
- `location.{displayLocation, mainDistance, publicTransportDistanceDescription}`
- `blocks[].{finalPrice.{amount, currency}, freeCancellationUntil}`
- `matchingUnitConfigurations.unitConfigurations[].{name, bedConfigurations[]}`

This is **dramatically richer** than DOM extraction — exact numeric prices, lat/lng, star ratings, bed configurations, discount info, all in one structured payload.

### Phase 4: GraphQL Query Discovery

**RoomPageDesktopRDS** — fires on hotel detail page load, returns 80KB:
- `reviewScores[]`: `{count, name, value, translatedName}` — category review scores (bed_comfort, staff, facilities, cleanliness, etc.)
- `roomDetail.property.roomsDetails[]`: room names, bed configurations, photos, sizes
- `categorizedFacilitiesForAllRooms[]`: room-level facility lists
- `highlightsForAllRooms[]`: room size highlights

Extracted the query structure and built simplified GraphQL queries:
- `ReviewScoresQuery` — fetches review category scores via `reviewScores(input: {hotelId, questions, customerType})`
- `RoomDetailQuery` — fetches room details via `roomDetail(roomDetailQueryInput: {hotelId, searchConfig})`

### Phase 5: Flights Investigation

**Flights API**: `flights.booking.com/api/flights/?type=ONEWAY&adults=1&depart=...&from=NYC.CITY&to=PAR.CITY&sort=BEST&enableVI=1`
- Returns 403 "Not authorized" from `page.evaluate(fetch(...))`
- Returns `SERVER_SIDE_UNKNOWN_ERROR` from Node.js fetch
- The API requires specific cookies/session state that only the initial page load establishes
- **Decision**: Keep DOM extraction for flights — `[data-testid]` selectors are the only viable approach

### Phase 6: Node Transport Test

Direct HTTP requests to `www.booking.com` and `flights.booking.com` return:
- PerimeterX challenge pages (403/captcha)
- Node transport NOT viable for any Booking.com operation
- All ops must stay on `page` transport

## Decision Matrix

| Op | Before | After | Rationale |
|---|---|---|---|
| searchHotels | DOM `[data-testid="property-card"]` | Apollo SSR cache | 512KB structured JSON, zero selectors, richer data |
| getHotelDetail | LD+JSON `@type: Hotel` | LD+JSON (unchanged) | Already structured and stable |
| getHotelReviews | DOM `[data-testid="review-*"]` | GraphQL `ReviewScoresQuery` | Structured scores, no selector fragility |
| getHotelPrices | DOM `table.hprt-table` | GraphQL `RoomDetailQuery` | Structured room/bed/facility data |
| searchFlights | DOM `[data-testid="flight_card_*"]` | DOM (unchanged) | Flights API returns 403, no alternative |

## Rejected Approaches

1. **Node transport**: PerimeterX blocks all node requests. Not viable for any op.
2. **Flights REST API intercept**: API returns 403 from both `page.evaluate(fetch)` and direct intercept. Requires session cookies only available during initial page render.
3. **Webpack module walk**: No useful webpack modules on detail pages. Search page has chunks but they're for UI components, not API clients.
4. **Full RoomPageDesktopRDS replay**: The original query is 2000+ chars with many fragments. Simplified queries (`ReviewScoresQuery`, `RoomDetailQuery`) work with fewer fields but return all needed data.

## Key Files

- `src/sites/booking/adapters/booking.ts` — new adapter (Apollo cache + GraphQL + LD+JSON + DOM)
- `src/sites/booking/adapters/booking-web.ts` — old adapter (DOM-only, superseded)
- `src/sites/booking/openapi.yaml` — all ops now reference `booking` adapter
- `src/sites/booking/manifest.json` — updated description

## Verification

5/5 ops PASS via `verify booking --browser`:
- searchHotels: 28 hotels with names, prices, ratings, distances from Apollo cache
- getHotelDetail: LD+JSON Hotel schema (name, rating, address, image)
- getHotelReviews: GraphQL review category scores (with DOM fallback)
- getHotelPrices: GraphQL room details (with DOM fallback)
- searchFlights: DOM flight cards (carrier, times, airports, duration, stops, price)

## Stability Assessment

| Op | Stability | Risk |
|---|---|---|
| searchHotels | High | Apollo cache structure could change (key naming), but `ROOT_QUERY.searchQueries` pattern is standard Apollo convention |
| getHotelDetail | High | LD+JSON is a web standard (schema.org), rarely changes |
| getHotelReviews | Medium-High | GraphQL schema field names (`reviewScores.name/value/count`) could change; DOM fallback available |
| getHotelPrices | Medium-High | GraphQL room schema could change; DOM fallback available |
| searchFlights | Medium | DOM `[data-testid]` selectors could change in UI redesigns |
