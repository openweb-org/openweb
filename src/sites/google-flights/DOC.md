# Google Flights

## Overview
Google Flights — flight search, route overview, and booking details. Adapter-based extraction.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchFlights | search flight results | GET /travel/flights/search | adapter: google-flights |
| getFlightOverview | route cheapest fares | GET /travel/flights | unverified |
| getFlightBookingDetails | booking/itinerary details | GET /travel/flights/booking | unverified |

## API Architecture
- **No REST API** — all data extracted from rendered Google Flights pages via adapter
- `tfs` query param encodes flight search parameters (origin, destination, dates) in an opaque format
- All 3 operations use the `google-flights` adapter for DOM extraction
- Returns structured data: airlines, times, prices, stops, CO2 emissions, baggage policies

## Auth
None — public search pages.

## Transport
- `page` — requires Google Flights page loaded in browser for DOM extraction

## Known Issues
- Site is **quarantined** (manifest `quarantined: true`)
- 2 of 3 operations unverified
- `tfs` parameter encoding is opaque — must be captured from actual Google Flights URLs
