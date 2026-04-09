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
