# Trip.com / Ctrip

## Overview
China's largest travel platform (Ctrip International). Flights, trains, attractions, and destination guides via Trip.com's internal POST-only REST APIs. Travel archetype.

## Workflows

### Search and compare flights
1. `searchPOI(key)` — find city codes for departure/arrival
2. `searchFlights(departCode, arriveCode, departDate)` — get flight itineraries with prices → `token`
3. `getFlightCalendarPrices(dCity, aCity, dDate)` — compare prices across dates
4. `getFlightComfort(flightNo, dCity, aCity, dDate)` — check seat, WiFi, entertainment for a specific flight
5. `getFlightFilters(token)` — get available filter options (airline, stops, cabin) for refining results

### Plan a train journey
1. `getTrainStations()` — get station list → `stationCode`
2. `searchTrains(departStation, arriveStation, departDate)` — find trains with schedules and prices
3. `getTrainCalendar(departStation, arriveStation, month)` — check availability across a month

### Explore a destination
1. `getHotDestinations()` — browse trending cities → `districtId`
2. `getCityList(countryId)` — browse cities in a country → `districtId`
3. `getDestinationInfo(districtId, moduleList)` — get travel guide (sights, hotels, restaurants)
4. `searchAttractions(sceneCode)` — find things to do → `productId`
5. `getAttractionDetail(productId)` — get attraction details, tickets, reviews

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPOI | find city/airport codes | key (keyword) | results[]{name, code, districtId} | entry point for flights/trains |
| searchFlights | search flights | departCode, arriveCode, departDate ← searchPOI | flightItineraryList[]{flightNo, airline, times, price}, token | requires Head object |
| getFlightCalendarPrices | cheapest fares per day | dCity, aCity, dDate ← searchPOI | lowPriceInCalenderDtoInfoList[]{date, price} | calendar view |
| getFlightComfort | aircraft comfort info | flightNo, dCity, aCity, dDate ← searchFlights | flightComfortList[]{seatPitch, wifi, entertainment} | |
| getFlightFilters | flight filter options | token ← searchFlights | filterList[]{filterType, options[]{label, value, count}} | refine search results |
| getTrainStations | list train stations | — | stationList[]{stationName, stationCode, cityName} | entry point for trains |
| searchTrains | search trains | departStation, arriveStation, departDate ← getTrainStations | trainList[]{trainNumber, times, seatList with prices} | |
| getTrainCalendar | train availability calendar | departStation, arriveStation, month ← getTrainStations | calendarList[]{date, available, lowestPrice} | |
| getHotDestinations | trending destinations | — | data[]{id, word, url} | entry point for exploration |
| getCityList | cities in a country | countryId | cityList[]{districtId, cityName, imageUrl} | entry point for exploration |
| getDestinationInfo | destination travel guide | districtId ← getHotDestinations/getCityList | hotDistrict, classicRecommendSight[]{poiName, rating}, classicRecommendHotel[]{hotelName, price}, hotComment[]{content, rating} | www.trip.com |
| searchAttractions | things to do | sceneCode (e.g., city_sight_list) | list[]{productId, productName, rating, price}, sortRuleList[]{sortType, sortName} | www.trip.com |
| getAttractionDetail | attraction detail | productId ← searchAttractions | description, rating, reviewCount, tickets, hours | www.trip.com |
| getGeneralInfo | site info/announcements | — | savedTips, travelTipsList[]{title, content}, promotionList[]{title, linkUrl}, noticeList[]{title, content} | utility |

## Quick Start

```bash
# Search for city codes
openweb ctrip exec searchPOI '{"key":"Tokyo","mode":"0","tripType":"OW"}'

# Search flights NYC → Shanghai
openweb ctrip exec searchFlights '{"searchCriteria":{"tripType":1,"journeyNo":1,"passengerInfoType":{"adultCount":1,"childCount":0,"infantCount":0},"journeyInfoTypes":[{"journeyNo":1,"departDate":"2026-05-01","departCode":"NYC","arriveCode":"SHA"}]},"Head":{"Locale":"en-US","Currency":"USD","Group":"Trip","Source":"ONLINE","Version":"3"}}'

# Get cheapest fares for a month
openweb ctrip exec getFlightCalendarPrices '{"dCity":"NYC","aCity":"SHA","dDate":"2026-05-01","flightWayType":"OW","cabinClass":"Economy"}'

# Browse trending destinations
openweb ctrip exec getHotDestinations '{"lang":"en","locale":"en-US","currency":"USD","dataType":"destinations","head":{"syscode":"999","locale":"en-US"}}'

# Get destination guide for Shanghai (districtId=2)
openweb ctrip exec getDestinationInfo '{"districtId":"2","moduleList":["classicRecommendSight"]}'

# Search attractions
openweb ctrip exec searchAttractions '{"baseInfo":{"channelId":24,"locale":"en-US","currency":"USD"},"sceneParams":[{"sceneCode":"city_sight_list"}]}'
```

---

## Site Internals

## API Architecture
- **All POST**: Every operation uses POST with JSON body, even reads.
- **URL pattern**: `/restapi/soa2/{serviceId}/{methodName}` — numbered service IDs map to internal microservices.
- **Two hosts**: `us.trip.com` (11 ops: flights, trains, POI, general) and `www.trip.com` (3 ops: destinations, attractions).
- **Head object**: Most APIs require a `Head` or `head` object with Locale, Currency, Group, Source. Without these, APIs return SourceEnum or locale errors. The browser session populates these via cookies/context.
- **City codes**: Flights use IATA codes (NYC, SHA). Destinations use numeric district IDs (2=Shanghai). Trains use station codes.

## Auth
- Auth type: `cookie_session` — browser cookies provide session context.
- No login required for search/read operations.
- Hotel detail pages are auth-gated (not included).
- The `Head.Source` field is resolved from browser session state, not user input.

## Transport
- `transport: page` — all requests execute via `page.evaluate(fetch(...))` inside the browser.
- Trip.com uses bot detection that blocks direct Node.js HTTP requests (403).
- Operations on `us.trip.com` need a `us.trip.com` tab open; `www.trip.com` ops need a `www.trip.com` tab.

## Extraction
- All operations return direct JSON — no SSR, DOM, or page_global extraction.

## Known Issues
- **Head/locale context**: Most `us.trip.com` APIs (searchPOI, searchFlights, getFlightCalendarPrices, getFlightComfort) return "SourceEnum cannot be null" or "grade is null" without proper browser session context. Verify passes (HTTP 200, shape matches) but response contains error content. Trip.com's JS framework injects locale/source context that cannot be replicated via simple fetch.
- **Train APIs return 609**: getTrainStations and searchTrains return error code 609 ("something went wrong") without proper session cookies. Verify passes because shape matches.
- **getDestinationInfo sparse**: Returns `result: 1` but no module data without full browser session. Works in verify with captured examples.
- **searchAttractions response drift**: Endpoint response shape changed — now includes `typename`, `serverTime`, `authUser`, `claimAllButtonText` fields. Returns empty list without proper session context.
- **Hotel search unavailable**: fetchHotelList API requires Trip.com's JavaScript framework headers (anti-CSRF/bot). Cannot be called via browser fetch.
- **Flight search SSE**: Primary flight search (FlightListSearchSSE) uses Server-Sent Events. This package uses the non-SSE variant (FlightListSearch) which returns standard JSON.
- **Unverified ops**: getFlightFilters, getAttractionDetail, getTrainCalendar, getCityList lack example fixtures. getAttractionDetail fails with CORS when page is on wrong origin.
