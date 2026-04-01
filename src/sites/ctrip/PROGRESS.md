# Ctrip / Trip.com Fixture — Progress

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
