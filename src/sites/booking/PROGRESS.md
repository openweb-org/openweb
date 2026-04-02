## 2026-04-02: Fix adapter navigation

**What changed:**
- Added `navigateTo()` helper — searchHotels, getHotelDetail, searchFlights
  now build and navigate to the correct URL before DOM extraction
- getHotelReviews/getHotelPrices remain virtual-path ops (extract from current
  hotel page, cannot navigate independently)

**Why:**
- Adapter received page at `booking.com/` but never navigated to search/detail
  URLs. All ops returned empty results.

**Key files:** `adapters/booking-web.ts`
**Verification:** `searchHotels '{"ss":"Tokyo"}'` → 25 hotels; `searchHotels '{"ss":"Paris"}'` → 25 hotels
**Commit:** b237c7c

## 2026-04-01: Fresh discovery — 5 operations

**What changed:**
- Created booking.com package from scratch with 5 operations
- searchHotels, getHotelDetail, getHotelReviews, getHotelPrices, searchFlights
- Adapter-based DOM/LD+JSON extraction (booking-web)
- Added flights search via flights.booking.com subdomain

**Why:**
- Prior package deleted during batch cleanup; rediscovering from scratch
- User requested: searchHotels, getHotelDetail, getHotelReviews, getHotelPrices, searchFlights

**Verification:** DOM selectors validated live on booking.com — search cards (28 results), LD+JSON Hotel schema, review-score-component, hprt-table rooms, flight cards (25 results)
**Commit:** pending
