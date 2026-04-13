# Expedia

## Overview
Travel booking platform. Hotels and flights search via GraphQL APQ (Automatic Persisted Queries).

## Workflows

### Search and inspect hotels
1. `searchHotels(destination, checkInDate, checkOutDate)` → hotel listings with `id`
2. `getHotelDetail(propertyId)` → amenities, policies, location, FAQs
3. `getHotelPrices(propertyId, checkInDate, checkOutDate)` → room types, nightly rates, availability
4. `getHotelReviews(propertyId)` → guest ratings, review text, overall score breakdown

### Search flights
1. `searchFlights(origin, destination, departureDate)` → flight listings with airline, times, stops, price
2. `getFlightDetail(origin, destination, departureDate)` → same data, used for refining results

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchHotels | find hotels by city/dates | destination, checkInDate, checkOutDate | id, name, price, rating, photos | entry point; paginated (offset, limit) |
| getHotelDetail | hotel info | propertyId ← searchHotels | amenities, location, policies, FAQs | |
| getHotelPrices | daily rate calendar | propertyId, checkInDate, checkOutDate | per-day nightly rates, availability across ~240 days | intercept pattern (navigates to hotel page) |
| getHotelReviews | guest reviews | propertyId ← searchHotels | ratings, review text, reviewer info, score breakdown | intercept pattern (navigates to hotel page) |
| searchFlights | find flights by route/dates | origin, destination, departureDate | airline, times, stops, price | entry point; paginated |
| getFlightDetail | flight info | origin, destination, departureDate | same as searchFlights | alias for refined search |

## Quick Start

```bash
# Search hotels in New York
openweb expedia exec searchHotels '{"destination":"New York","checkInDate":"2026-05-01","checkOutDate":"2026-05-03"}'

# Get hotel detail
openweb expedia exec getHotelDetail '{"propertyId":"27924","checkInDate":"2026-05-01","checkOutDate":"2026-05-03"}'

# Get hotel prices for dates
openweb expedia exec getHotelPrices '{"propertyId":"27924","checkInDate":"2026-05-01","checkOutDate":"2026-05-03"}'

# Get hotel reviews
openweb expedia exec getHotelReviews '{"propertyId":"27924"}'

# Search flights NYC to LA
openweb expedia exec searchFlights '{"origin":"New York (NYC-All Airports)","destination":"Los Angeles (LAX-Los Angeles Intl.)","departureDate":"2026-05-10","returnDate":"2026-05-17"}'

# One-way flight search
openweb expedia exec getFlightDetail '{"origin":"San Francisco (SFO)","destination":"Chicago (ORD-O'\''Hare Intl.)","departureDate":"2026-06-15"}'
```
