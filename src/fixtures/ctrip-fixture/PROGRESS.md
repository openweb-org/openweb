# Ctrip / Trip.com Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created ctrip-fixture with 10 operations across flights, trains, destinations, attractions, and POI search
- All 10 operations verified PASS via `pnpm dev verify ctrip-fixture`

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
