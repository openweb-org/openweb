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

## 2026-04-18 — getHotelDetail Fresh-Nav Fix (bde6e5d)

**Context:** verify-fix-0418 sweep — `getHotelDetail` failed with `No <script> matching "script[type=\"application/ld+json\"]" had @type "Hotel".`
**Changes:**
- Added op-level `page_plan.entry_url: https://www.booking.com/hotel/{country}/{slug}.html` with `wait_until: domcontentloaded` and `ready: script[type="application/ld+json"]`.
- Added server-level `page_plan.warm: true` for bot-sensor warm-up.
- Replaced fixture slug `riverside-tower` (non-existent hotel) with `new-york-manhattan-times-square-west`.
**Verification:** 5/5 PASS (`pnpm dev verify booking`).
**Root cause:** Two compounding bugs. (1) Fixture slug was a 404, so any nav to it returned a non-hotel page. (2) Without explicit `entry_url`, the runtime's `allow_origin_fallback` reused any same-origin booking.com tab (homepage / flights / search results) for extraction — those don't carry the `Hotel` JSON-LD. Forcing fresh per-op navigation eliminates both.
**Key discovery:** Page-extraction ops on multi-section sites must declare `entry_url` even when an existing same-origin tab is available — origin-fallback page reuse is silently wrong when the tab's content doesn't match the op's intent.
