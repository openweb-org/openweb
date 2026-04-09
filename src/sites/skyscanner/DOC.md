# Skyscanner

Flight comparison and booking search engine.

## Workflows

### Search for Flights
```
searchFlights(origin, destination, date) → results[].id, price, legs, carriers
```

### Compare Prices Across Dates
```
getPriceHistory(origin, destination) → days[].day, price, group
  └── pick cheapest date → searchFlights(origin, destination, cheapestDate)
```

### Get Detailed Flight Info
```
getFlightDetail(origin, destination, date) → results[].legs[].segments[], farePolicy
```
Same data as searchFlights — returns full segment, carrier, and fare info.

## Operations

| operationId | Intent | Key Input | Key Output | Notes |
|---|---|---|---|---|
| searchFlights | Search flights for a route+date | origin (IATA), destination (IATA), date | results[].price, legs[].departure/arrival, carriers, stopCount | ← user provides IATA codes |
| getFlightDetail | Get detailed flight info | origin, destination, date | results[].legs[].segments[].flightNumber, marketingCarrier, farePolicy | Same as search with full details |
| getPriceHistory | Price trends for a route | origin (IATA), destination (IATA) | days[].day, price, group | ~300 days of daily prices |

## Quick Start

```bash
# Search flights LAX → JFK on May 15
openweb skyscanner exec searchFlights '{"origin":"LAX","destination":"JFK","date":"2026-05-15"}'

# Get price trends LAX → JFK
openweb skyscanner exec getPriceHistory '{"origin":"LAX","destination":"JFK"}'

# Detailed flight info with cabin class
openweb skyscanner exec getFlightDetail '{"origin":"SFO","destination":"LHR","date":"2026-06-01","cabinClass":"business"}'
```

---

## Site Internals

### API Architecture
- **Flight search**: `POST /g/radar/api/v2/web-unified-search/` + polling (GET with session token)
  - Initial POST returns partial results (status: "incomplete")
  - Subsequent GETs poll until status: "complete"
  - Returns itineraries with legs, segments, carriers, prices, scores
- **Price calendar**: `POST /g/search-intent/v1/pricecalendar`
  - Returns ~300 days of daily cheapest prices
  - Categorizes prices into low/medium/high groups
- Entity IDs: airports use IATA codes in URLs, internal entity IDs in API payloads

### Auth
- Anonymous session cookies (`__Secure-anon_token`, `__Secure-session_id`)
- No login required for search
- CSRF token present but not needed for read operations

### Transport
- **page** (all operations) — heavy bot detection blocks node HTTP
- searchFlights/getFlightDetail: intercept pattern (navigate to search URL, capture radar API responses)
- getPriceHistory: browser-side fetch (direct `page.evaluate(fetch)`)

### Bot Detection
- Cloudflare (`cf_clearance`)
- PerimeterX (`_px3`, `_pxhd`) — press-and-hold captcha on direct URL navigation
- DataDome (`datadome`)
- Captcha auto-resolved via press-and-hold in adapter

### Known Issues
- PerimeterX captcha may trigger on first navigation; adapter handles it automatically
- Search API uses polling — results arrive progressively over ~5-15 seconds
- Search API returns 400 on direct browser-side fetch; must use intercept pattern
