# Google Flights

## Overview
Flight search and pricing — mixed transport: searchFlights and getPriceInsights use node SSR extraction from AF_initDataCallback; overview, booking, and explore use page DOM extraction.

## Workflows

### Search flights on a route
1. `searchFlights(tfs)` → flight results with airline, times, price, stops, legs, aircraft, flight numbers

### Explore destinations from an origin
1. `exploreDestinations()` → destination cards with flight/hotel prices, dates
2. Pick a destination → `searchFlights(tfs)` for specific route

### Price research for a route
1. `searchFlights(tfs)` → current flight options and prices
2. `getPriceInsights(tfs)` → price history, typical price, airline list, route price range

### Book a specific itinerary
1. `searchFlights(tfs)` → pick a flight
2. `getFlightBookingDetails(tfs)` → leg details, baggage policies, booking links

## Operations

| Operation | Intent | Key Input | Key Output | Transport | Notes |
|-----------|--------|-----------|------------|-----------|-------|
| searchFlights | search flights by route and dates | tfs (encoded route+dates) | origin, destination, flights[].airline, price, stops, duration, legs[] | node | SSR extraction; verified |
| getPriceInsights | price statistics and trends for a route | tfs (encoded route) | currentLowPrice, typicalPrice, priceHistory[], popularAirlines[] | node | SSR extraction; verified |
| getFlightOverview | cheapest fares and fastest flight for a route | tfs (encoded route) | cheapestOptions[].price, airline, fastestFlight, nonstopFrequency | page | DOM extraction |
| getFlightBookingDetails | itinerary details with baggage | tfs (encoded itinerary) | totalPrice, legs[].airline, duration, bagPolicies, bookWith | page | DOM extraction |
| exploreDestinations | browse destinations by budget from origin | — (uses default origin) | destinations[].destination, flightPrice, hotelPricePerNight, dates | page | DOM extraction; RPC-loaded data |

## Quick Start

```bash
# Search flights RDU → NYC
openweb google-flights exec searchFlights '{"tfs":"CBwQAhopEgoyMDI2LTA1LTE1agwIAhIIL20vMGZ2eWdyDQgDEgkvbS8wMl8yODYaKRIKMjAyNi0wNS0yMGoNCAMSCS9tLzAyXzI4NnIMCAISCC9tLzBmdnlnQAFIAXABggELCP___________wGYAQE"}'

# Price insights for a route
openweb google-flights exec getPriceInsights '{"tfs":"CBwQAhopEgoyMDI2LTA1LTE1agwIAhIIL20vMGZ2eWdyDQgDEgkvbS8wMl8yODYaKRIKMjAyNi0wNS0yMGoNCAMSCS9tLzAyXzI4NnIMCAISCC9tLzBmdnlnQAFIAXABggELCP___________wGYAQE"}'

# Explore destinations (requires browser)
openweb google-flights exec exploreDestinations '{}'
```

---

## Site Internals

## API Architecture
- No public REST API — Google Flights embeds structured data in SSR via `AF_initDataCallback` scripts
- `ds:1` key (114K+ chars) contains all flight search results, route info, price statistics, and filter metadata as deeply nested arrays
- Explore page destinations are loaded via client-side RPC (`FlightsFrontendService/GetExploreDestinations`), not SSR
- `tfs` query param encodes flight search parameters (origin, destination, dates) in opaque protobuf-based format

## Auth
No auth required — public search pages. No bot detection cookies observed (no `_abck`, `_px3`, `cf_clearance`). Native `fetch` (not monkey-patched).

## Transport

| Operation | Transport | Tier | Extraction method |
|-----------|-----------|------|------------------|
| searchFlights | node | 3 (SSR) | nodeFetch HTML → parse AF_initDataCallback ds:1 → nested array extraction |
| getPriceInsights | node | 3 (SSR) | nodeFetch HTML → parse AF_initDataCallback ds:1 → price stats from ds1[5], filters from ds1[7] |
| getFlightOverview | page | 2 (DOM) | page.evaluate → document.body.innerText regex |
| getFlightBookingDetails | page | 2 (DOM) | page.evaluate → document.body.innerText regex |
| exploreDestinations | page | 2 (DOM) | page.evaluate → li element iteration with regex |

## SSR Data Structure (AF_initDataCallback ds:1)

Google's SSR data delivery via `AF_initDataCallback({key: 'ds:N', data: [...]})` script tags:

| Key | Content | Size |
|-----|---------|------|
| ds:0 | Session/config metadata | ~2K |
| ds:1 | **Flight data** — route info, offers, price stats, filters, airport directory | ~114K |
| ds:2 | Country list | ~3.5K |
| ds:3 | Currency list | ~2.3K |
| ds:4 | Language list | ~2.2K |

### ds:1 field mapping

| Path | Content |
|------|---------|
| ds1[1] | Route info — origin/destination cities, airport codes, images |
| ds1[2][0] | Best/featured flight offers array |
| ds1[3][0] | All other flight offers array |
| ds1[5] | Price statistics — low price, typical, range, price history |
| ds1[7] | Filter metadata — price range, alliances, airlines list, airports |
| ds1[11] | Baggage policy URLs per airline |
| ds1[17] | Airport directory (~140 airports) |

### Flight offer structure

Each offer is `[details, priceInfo]` where:
- `details[0]` = airline IATA code
- `details[1]` = airline names array
- `details[2]` = legs array (each leg: origin[3], dest[6], depTime[8], arrTime[10], duration[11], aircraft[17], flightNum[22])
- `details[3..8]` = origin, depDate, depTime, dest, arrDate, arrTime
- `details[9]` = total duration minutes
- `details[22]` = emissions stats (emPct at [3], co2g at [7])
- `priceInfo[0][1]` = price in USD

## Internal: Probe Results

| Family | Representative page/action | Evidence kind | Transport hypothesis | Lane | Notes |
|--------|---------------------------|---------------|---------------------|------|-------|
| search | /travel/flights/search?tfs=... | ssr (AF_initDataCallback ds:1) | node — verified | extraction | Node fetch returns 200, 3.7MB HTML, all flight data in SSR; no bot detection |
| insights | /travel/flights/search?tfs=... | ssr (AF_initDataCallback ds:1) | node — verified | extraction | Same page, price stats in ds1[5], filters in ds1[7] |
| overview | /travel/flights?tfs=... | dom | page_required | adapter | Different page URL; SSR may exist but untested |
| booking | /travel/flights/booking?tfs=... | dom | page_required | adapter | Itinerary-specific page; SSR may exist but untested |
| explore | /travel/explore | api (client-side RPC) | page_required | adapter | RPC uses session-bound headers (f.sid, x-goog-batchexecute-bgr); no SSR data for destinations |

## Known Issues
- `tfs` parameter encoding is opaque — must be captured from actual Google Flights URLs
- searchFlights returns both departing and returning leg offers (round-trip); filter by direction if needed
- getFlightOverview and getFlightBookingDetails require page-specific tfs values — a search tfs may return empty data
- exploreDestinations requires browser (destinations loaded via RPC, not SSR)
- AF_initDataCallback ds:1 structure uses deeply nested positional arrays — field positions may shift on Google redeploys
