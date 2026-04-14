## 2026-04-13: Fix getHotelReviews — Akamai 403 bypass

**Context:** `getHotelReviews` failing with Akamai 403. The `.Hotel-Reviews` URL is blocked more aggressively than `.Hotel-Information`. IP was previously banned but now unblocked.

**Root cause:** Navigating to `h{id}.Hotel-Reviews` triggers Akamai's stricter bot detection for that URL pattern.

**Fix:**
- Changed navigation from `.Hotel-Reviews` to `.Hotel-Information` (same page used by `getHotelPrices`)
- Reviews are lazy-loaded via GraphQL when user scrolls to reviews section
- Added scroll-to-trigger logic: scroll to 50%/80%/100% of page height, click reviews tab/link if found
- Made intercept handler selective — only captures GraphQL responses containing actual review arrays (skips empty `productReviewSummary` responses)

**Verification:** `pnpm dev expedia exec getHotelReviews '{"propertyId":"27924"}' --browser --headed` → 25 reviews, 89KB response, 1009 total reviews, 9.0/10 rating

**Key discovery:** The `.Hotel-Information` page loads review data lazily via a separate GraphQL query (`PropertyFilteredReviewsQuery`) when the reviews section scrolls into viewport. The initial page load fires a review summary query with null data — must filter for responses containing actual review arrays.

## 2026-04-09: Add hotel reviews and prices — 4 → 6 operations

**What changed:**
- Added `getHotelPrices` — room pricing/availability via `PropertyRatesDateSelectorQuery` APQ hash (already captured, previously unused)
- Added `getHotelReviews` — guest reviews via intercept pattern (navigate to hotel reviews page, capture GraphQL response)
- Updated openapi.yaml with both new operations, response schemas, and examples
- DOC.md updated with new workflows, operations table, and adapter lane docs

**Why:**
- Hotel detail workflow was missing pricing and review data — two core hotel research intents

**Design decisions:**
- getHotelPrices uses direct APQ fetch (hash already available, consistent with existing ops)
- getHotelReviews uses intercept pattern (no APQ hash captured for reviews query; intercept is hash-independent and survives Expedia deploys)

## 2026-04-01: Initial discovery — hotels + flights

**What changed:**
- Discovered Expedia uses single GraphQL endpoint with APQ (persisted query hashes)
- 4 operations: searchHotels, getHotelDetail, searchFlights, getFlightDetail
- Adapter-based package (page transport required due to Akamai)

**Why:**
- User requested hotel and flight search capabilities
- Standard compile couldn't sub-cluster GraphQL — manual adapter required

**Verification:** adapter builds, operations exec via page transport
