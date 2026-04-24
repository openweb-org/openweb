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

---

## Site Internals

### API Architecture
Single GraphQL endpoint (`POST /graphql`) using APQ — only sha256 hashes sent, no query text. Different `client-info` headers per product vertical:
- Lodging: `shopping-pwa,...`
- Flights: `flights-shopping-pwa,...`

Batched queries common on page load (multiple operations in one request).

### Adapter Lanes
- **APQ direct fetch** (searchHotels, getHotelDetail): `page.evaluate(fetch)` with APQ hash. Requires known hash — breaks if Expedia redeploys with new hashes.
- **Intercept** (getHotelPrices, getHotelReviews, searchFlights, getFlightDetail): Navigate to the actual Expedia page URL and intercept GraphQL responses. Hash-independent — survives Expedia deploys. searchFlights navigates to the flights search results page. getHotelReviews scrolls to trigger lazy-loaded review data.
- **Response trimming**: All operations strip `__typename`, analytics, clickstream, and UI rendering metadata via `STRIP_KEYS`. Flight search additionally strips `detailsAndFares` (fare dialog modal content, ~100KB per listing).

### Auth
No auth required for public search. `cookie_session` for logged-in features. `DUAID` cookie used for device identity. `EG_SESSIONTOKEN` for authenticated sessions.

### Transport
`page` — Akamai Bot Manager (`_abck`, `bm_*` cookies) blocks all node HTTP requests. Must execute within browser context.

### Known Issues
- **Akamai Bot Manager**: Heavy bot detection. Node transport gets 403/429. Page transport required.
- **APQ hash stability**: Hotel APQ hashes (PropertyListingQuery, PropertyDetailsBasicQuery) may change on Expedia deploys. Flight operations use the intercept pattern and are immune to hash changes.
- **Locale redirect**: Browser with CN locale gets redirected to `/cn/` paths. Search results show in Chinese. Set browser locale to en_US for English results.
- **Flight search progressive loading**: Flight search captures the first complete response. Return leg data may be null if not yet loaded during progressive rendering.
- **getHotelReviews navigation**: Intercept navigates to `.Hotel-Information` (not `.Hotel-Reviews`, which Akamai blocks more aggressively), then scrolls to trigger lazy-loaded review GraphQL. Shares the same page URL pattern as getHotelPrices.
