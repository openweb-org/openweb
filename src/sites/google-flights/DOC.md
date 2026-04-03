# Google Flights

## Overview
Flight search and pricing — adapter-based DOM extraction from rendered Google Flights pages.

## Workflows

### Search flights on a route
1. `searchFlights(tfs)` → flight results with airline, times, price, stops

### Explore destinations from an origin
1. `exploreDestinations()` → destination cards with flight/hotel prices, dates
2. Pick a destination → `searchFlights(tfs)` for specific route

### Price research for a route
1. `searchFlights(tfs)` → current flight options and prices
2. `getPriceInsights(tfs)` → cheapest/most expensive months, price trend, popular airlines

### Book a specific itinerary
1. `searchFlights(tfs)` → pick a flight
2. `getFlightBookingDetails(tfs)` → leg details, baggage policies, booking links

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchFlights | search flights by route and dates | tfs (encoded route+dates) | origin, destination, flights[].airline, price, stops, duration | entry point; verified |
| getFlightOverview | cheapest fares and fastest flight for a route | tfs (encoded route) | cheapestOptions[].price, airline, fastestFlight, nonstopFrequency | |
| getFlightBookingDetails | itinerary details with baggage | tfs (encoded itinerary) | totalPrice, legs[].airline, duration, bagPolicies, bookWith | |
| exploreDestinations | browse destinations by budget from origin | — (uses default origin) | destinations[].destination, flightPrice, hotelPricePerNight, dates | entry point |
| getPriceInsights | monthly price trends and predictions | tfs (encoded route) | priceTrend, cheapestMonth, mostExpensiveMonth, popularAirlines | |

## Quick Start

```bash
# Search flights RDU → LGA (tfs from Google Flights URL)
openweb google-flights exec searchFlights '{"tfs":"CBwQAhopEgoyMDI2LTA0LTMwagwIAhIIL20vMGZ2eWdyDQgDEgkvbS8wMl8yODYaKRIKMjAyNi0wNS0wNGoNCAMSCS9tLzAyXzI4NnIMCAISCC9tLzBmdnlnQAFIAXABggELCP___________wGYAQE"}'

# Explore destinations (default origin)
openweb google-flights exec exploreDestinations '{}'

# Price insights for a route
openweb google-flights exec getPriceInsights '{"tfs":"CBwQAhopEgoyMDI2LTA0LTMwagwIAhIIL20vMGZ2eWdyDQgDEgkvbS8wMl8yODYaKRIKMjAyNi0wNS0wNGoNCAMSCS9tLzAyXzI4NnIMCAISCC9tLzBmdnlnQAFIAXABggELCP___________wGYAQE"}'
```

---

## Site Internals

## API Architecture
- No REST API — all data extracted from rendered Google Flights pages via adapter
- `tfs` query param encodes flight search parameters (origin, destination, dates) in an opaque protobuf-based format
- All 5 operations use the `google-flights` adapter for DOM extraction

## Auth
No auth required — public search pages.

## Transport
`page` — requires browser for DOM extraction. All operations use the `google-flights` adapter (`adapters/google-flights.ts`).

## Extraction
- searchFlights: CSS selector `li.pIav2d` for flight result items, regex for fields
- getFlightOverview: `document.body.innerText` regex for "Cheapest" blocks, fastest flight
- getFlightBookingDetails: `document.body.innerText` regex for leg details, baggage policies
- exploreDestinations: `li` elements filtered by price delimiter `$`, regex for fields
- getPriceInsights: `document.body.innerText` regex for price trends, months, airlines

## Known Issues
- `tfs` parameter encoding is opaque — must be captured from actual Google Flights URLs
- searchFlights may extract duplicate entries (departing + returning legs counted separately)
- getFlightOverview and getFlightBookingDetails require page-specific tfs values (route overview / itinerary selection) — a search tfs will return empty data
- getPriceInsights month/airline data depends on route availability — some routes only return priceTrend
- Filters (stops, airlines, duration) are client-side — adapter extracts whatever is currently displayed
