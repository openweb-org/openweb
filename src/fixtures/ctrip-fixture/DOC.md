# Trip.com / Ctrip

## Overview
China's #1 travel platform (Ctrip International). Flights, hotels, trains, attractions, and travel guides via Trip.com's internal REST APIs. All APIs use POST with JSON request/response bodies.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchFlights | search flights by route and date | POST /restapi/soa2/27015/FlightListSearch | returns flight itineraries with airlines, stops, prices |
| getFlightCalendarPrices | lowest prices per day for a route | POST /restapi/soa2/14427/GetLowPriceInCalender | calendar view of cheapest fares |
| getFlightComfort | comfort ratings per flight segment | POST /restapi/soa2/14427/BatchGetFlightComfort | seat, WiFi, entertainment info |
| getGeneralInfo | general site info and announcements | POST /restapi/soa2/27501/getGeneralInfo | config, promotions, notices |
| getHotDestinations | trending travel destinations | POST /restapi/soa2/20400/getGsHotSearchForTripOnline | popular cities (via www.trip.com) |
| searchTrains | search trains by route and date | POST /restapi/soa2/31699/searchListForWeb | schedules, prices, seat availability |
| getTrainStations | list train stations | POST /restapi/soa2/36040/loadStationList | station names, codes, countries |
| searchPOI | search cities/airports by keyword | POST /restapi/soa2/14427/poiSearch | autocomplete for flight/hotel/train search |
| getDestinationInfo | travel guide for a destination | POST /restapi/soa2/23044/getDestinationPageInfo.json | attractions, hotels, restaurants (via www.trip.com) |
| searchAttractions | search attractions and tours | POST /restapi/soa2/28181/json/getByScenesCode | tickets, tours, experiences (via www.trip.com) |

## API Architecture
- **All POST**: Every operation uses POST with JSON body — even read operations. No GET endpoints for data.
- **API pattern**: `/restapi/soa2/{serviceId}/{methodName}` on `us.trip.com` and `www.trip.com`
- **Two hosts**: `us.trip.com` (US locale, 7 operations) and `www.trip.com` (destination/attractions, 3 operations)
- **Service IDs**: 27015 (flights search), 14427 (flights util/POI), 27501 (general), 20400 (hot search), 31699/36040 (trains), 23044 (destination), 28181 (attractions)
- **Request headers**: Most requests include a `Head` object with Locale, Currency, Group, Source fields
- **City codes**: Flight cities use IATA codes (NYC, SHA, LON). Destinations use numeric district IDs (2=Shanghai). Trains use station codes.

## Auth
- No auth needed for search/read operations
- `requires_auth: false`
- Hotel detail pages redirect to sign-in (auth-gated, not included in fixture)
- Hotel search (fetchHotelList) requires Trip.com framework headers — cannot be called via simple browser fetch

## Transport
- `transport: page` — browser-mediated fetch via page.evaluate()
- Requires open Trip.com tab in the browser
- Operations on `us.trip.com` need a `us.trip.com` tab; operations on `www.trip.com` need a `www.trip.com` tab

## Known Issues
- **Hotel search unavailable**: fetchHotelList/fetchDynamicRefreshList APIs require Trip.com's JavaScript framework headers (anti-CSRF/bot). Cannot be called via simple browser fetch.
- **Flight search SSE**: The primary flight search endpoint (FlightListSearchSSE) uses Server-Sent Events. The fixture uses the non-SSE variant (FlightListSearch) which returns standard JSON.
- **Head object required**: Most APIs need a `Head` object with `Locale`, `Currency`, `Group`, `Source` fields. Without these, APIs return errors like "locale cannot be blank".
- **A/B testing**: Request headers contain A/B test flags that may affect response format.
- **Locale sensitivity**: The `us.trip.com` domain may redirect or switch locale based on IP/cookies.
