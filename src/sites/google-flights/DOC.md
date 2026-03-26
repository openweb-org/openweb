# Google Flights

## Overview
Google Flights — flight search, route overview, booking details, destination explorer, and price insights. Adapter-based DOM extraction from rendered pages.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchFlights | search flight results by route and dates | GET /travel/flights/search | adapter: google-flights, verified |
| getFlightOverview | route cheapest fares and fastest flight | GET /travel/flights | adapter: google-flights |
| getFlightBookingDetails | booking/itinerary details with baggage | GET /travel/flights/booking | adapter: google-flights |
| exploreDestinations | browse destinations by budget from origin | GET /travel/explore | adapter: google-flights, new |
| getPriceInsights | monthly price trends, predictions, popular airlines | GET /travel/flights/search/insights | adapter: google-flights, new |

## API Architecture
- **No REST API** — all data extracted from rendered Google Flights pages via adapter
- `tfs` query param encodes flight search parameters (origin, destination, dates) in an opaque protobuf-based format
- All 5 operations use the `google-flights` adapter for DOM extraction
- searchFlights: extracts `li.pIav2d` flight result items (times, airline, price, stops, CO2)
- getFlightOverview: extracts "Cheapest" price blocks, fastest flight, nonstop frequency
- getFlightBookingDetails: extracts leg details, baggage policies, booking links via regex
- exploreDestinations: extracts `li` destination cards from explore map page (flight price, hotel price, dates, stops)
- getPriceInsights: extracts cheapest/most expensive months, price ranges, trend predictions, popular airlines

## Auth
None — public search pages.

## Transport
- `page` — requires Google Flights page loaded in browser for DOM extraction
- exploreDestinations uses `/travel/explore` page
- All other operations use `/travel/flights` or `/travel/flights/search` pages

## Extraction
- DOM text content parsed with regex patterns
- searchFlights uses CSS selector `li.pIav2d` for flight result items
- Other operations use `document.body.innerText` regex matching
- exploreDestinations splits on `$` delimiter to separate flight/hotel prices
- Origin/destination read from `input[aria-label*="Where from/to"]`

## Known Issues
- Site is **quarantined** (manifest `quarantined: true`)
- `tfs` parameter encoding is opaque — must be captured from actual Google Flights URLs
- searchFlights may extract duplicate entries (departing + returning legs counted separately)
- Date grid/calendar prices visible in date picker overlay not yet captured as a separate operation
- Filters (stops, airlines, duration, etc.) are client-side — adapter extracts whatever is currently displayed
