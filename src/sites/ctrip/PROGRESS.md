# Ctrip / Trip.com Fixture — Progress

## 2026-04-25: Userflow QA — adapter + session context investigation

**Workflows tested:**
1. "Cheapest flight SHA→TYO next month": searchPOI → searchFlights → getFlightComfort → getFlightFilters
2. "Train trip Shanghai→Beijing": getTrainStations → getTrainCalendar → searchTrains
3. "Explore Bangkok attractions": getHotDestinations → getCityList → searchAttractions → getAttractionDetail → getDestinationInfo

**Findings — most operations return error/empty data despite HTTP 200:**

| Operation | Status | Response |
|-----------|--------|----------|
| getHotDestinations | OK | 5 destinations, clean data |
| getGeneralInfo | OK | Sparse (`savedTips:false`) |
| searchFlights | DEGRADED | "locale cannot be blank" → "grade is null" after Head enrichment |
| searchPOI | DEGRADED | "SourceEnum cannot be null" — empty after null strip |
| getFlightComfort | DEGRADED | "SourceEnum cannot be null" |
| searchTrains | BROKEN | 609 "Something went wrong" |
| getTrainStations | BROKEN | 609 "Something went wrong" |
| getTrainCalendar | BLOCKED | HTTP 403 |
| getAttractionDetail | BLOCKED | HTTP 403 |
| getCityList | BLOCKED | HTTP 403 |
| getDestinationInfo | DEGRADED | Returns `{result:1}` — no data |
| searchAttractions | DEGRADED | Empty list or 5000 NPE error |
| getFlightFilters | UNTESTED | Requires token from searchFlights |

**Root cause: IP-based geo-redirect corrupts session context.**

Trip.com's server detects the headless browser's IP region and redirects to `locale=es-us`. Confirmed by navigating to `us.trip.com/flights` → redirect to `us.trip.com/?locale=es-us`. Trip.com's JS framework injects `SourceEnum`, locale, `Channel`, `ClientID` into API request bodies. Without a properly initialized session, most APIs return error messages inside HTTP 200 responses.

**What changed:**

1. **Added adapter `adapters/ctrip.ts`:**
   - Enriches `Head` (uppercase) with `Channel`, `SessionId`, `PvId` for flight/POI services
   - Enriches `head` (lowercase) with `syscode`, `lang`, `cver`, `sid`, `source` for train/destination services
   - Applies nested defaults for searchFlights (`grade`, `realGrade`, `passengerInfoType`)
   - Strips `ResponseStatus` and `responseHead` metadata from all responses
   - 30s pageFetch timeout; enabled for 12/13 ops (getFlightComfort `adapter: false`)

2. **Schema fix:** Removed `required: [Head]` from searchFlights body schema — adapter provides defaults.

**Response size (getHotDestinations):** 918B → 584B (ResponseStatus stripped).

**Verification:** 9/9 PASS (`pnpm dev verify ctrip`). Adapter pattern baseline updated.

**Known issues:**
- APIs return HTTP 200 with error content when session context is stale — verify passes on status but data quality is degraded.
- www.trip.com endpoints (getCityList, getAttractionDetail, getTrainCalendar) return 403 — WAF blocks headless browsers.
- Train services (31699, 36040) return 609 — possibly geo-restricted.
- Fix requires: US-based proxy, or reverse-engineering Trip.com SOA framework header injection.

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created ctrip with 10 operations across flights, trains, destinations, attractions, and POI search
- All 10 operations verified PASS via `pnpm dev verify ctrip`

**Operations:**
searchFlights, getFlightCalendarPrices, getFlightComfort, getGeneralInfo, getHotDestinations, searchTrains, getTrainStations, searchPOI, getDestinationInfo, searchAttractions

**Why:**
- Ctrip/Trip.com is China's #1 travel platform — flight, hotel, and train search are high-value operations
- All 10 operations work without auth via Trip.com's internal REST APIs (`/restapi/soa2/` pattern)
- Hotel search APIs (fetchHotelList) require framework-injected headers and were excluded

**Discovery process:**
1. Browsed Trip.com systematically via Playwright + CDP (flights, hotels, trains, attractions, destination guides)
2. Captured API traffic via CDP network monitoring across ~196 snapshots
3. Identified Trip.com's POST-only API architecture: `/restapi/soa2/{serviceId}/{method}`
4. Manually compiled fixture because: (a) automated compile filters POST requests (b) Trip.com APIs use POST for reads
5. Key APIs: FlightListSearch (non-SSE), GetLowPriceInCalender, BatchGetFlightComfort, searchListForWeb, loadStationList, poiSearch, getDestinationPageInfo, getByScenesCode, getGsHotSearchForTripOnline, getGeneralInfo
6. Hotel search APIs return 400 when called via simple browser fetch — they need Trip.com's JavaScript framework headers (anti-CSRF)

**Verification:** All 10 operations PASS (2026-03-24)

**Knowledge updates:** Trip.com uses a POST-only REST API pattern with numbered service IDs — novel for the project. Hotel APIs require framework-specific headers.

## 2026-03-31: Curation — enriched schemas, 14 operations, DOC.md rewrite

**What changed:**
- Added `auth: cookie_session` to server-level x-openweb (browser session provides locale/source context)
- Enriched all bare `type: object` response schemas with properties inferred from error responses and API patterns
- Added 4 new operations: getFlightFilters (ct0011), getAttractionDetail (ct0012), getTrainCalendar (ct0013), getCityList (ct0014)
- Added request params for searchTrains (departStation, arriveStation, departDate) — previously had only bare head object
- Updated searchPOI response schema to match actual response fields (results, isRecommend, key)
- Updated getFlightCalendarPrices response to match actual field name (lowPriceInCalenderDtoInfoList)
- Improved all operation summaries with 3-5 key response fields
- Rewrote DOC.md with workflows, operations table with data flow annotations, quick start commands
- Updated getHotDestinations response with code, iconName fields from live exec

**Why:**
- Bare schemas gave agents no information about response structure
- Missing workflows made it unclear how operations connect
- 4 new operations complete the travel workflow coverage (filter flights, attraction detail, train calendar, city browsing)

**Verification:** Original 10 operations PASS via `pnpm dev verify ctrip` (no examples for 4 new ops)

**Known issue:** Trip.com APIs return HTTP 200 with error content (SourceEnum/locale errors) when browser session context is stale. Verify passes on status code but response may not contain useful data without a fresh Trip.com page session.

## 2026-04-13 — Schema Fix

**Context:** Flight and train response objects omit certain fields depending on route availability and carrier.
**Changes:** openapi.yaml — removed strict required on flight/train response schemas.
**Verification:** Verify pass; schemas now tolerate optional fields in live responses.

## 2026-04-18 — searchPOI Schema Relax (347afb2)

**Context:** verify-fix-0418 sweep — `searchPOI` failed with `data/isRecommend must be boolean`.
**Changes:** openapi.yaml — broadened `searchPOI.data.isRecommend` from `boolean` (nullable) to `[boolean, integer, "null"]`. Upstream returns `0` / `1` for some POI categories.
**Verification:** 9/9 PASS (`pnpm dev verify ctrip`).
