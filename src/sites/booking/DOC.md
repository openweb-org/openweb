# Booking.com

## Overview
Travel platform — hotel search, property details, reviews, room pricing, and flight search via browser DOM/LD+JSON extraction.

## Workflows

### Find a hotel and check prices
1. `searchHotels(ss, checkin, checkout)` → pick hotel → `url` contains `/hotel/{country}/{slug}.html`
2. `getHotelDetail(country, slug)` → name, rating, address, description
3. `getHotelPrices(slug)` → room types, beds, prices (requires hotel page open)
4. `getHotelReviews(slug)` → score, subscores, featured reviews (requires hotel page open)

### Search flights
1. `searchFlights(route, from, to, depart)` → carriers, times, duration, stops, prices

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchHotels | find hotels in a destination | ss (query), checkin, checkout | name, url, price, rating, reviewCount | entry point; up to 30 results |
| getHotelDetail | hotel info by URL | country, slug ← searchHotels url | name, rating, description, address, image | LD+JSON Hotel schema |
| getHotelReviews | review summary | slug ← searchHotels url | score, subscores, featured reviews | requires hotel detail page open |
| getHotelPrices | room availability + pricing | slug ← searchHotels url | room name, bed, size, price, perNight | requires hotel detail page open |
| searchFlights | find flights by route | route (NYC-PAR), from, to, depart | carrier, times, airports, duration, stops, price | flights.booking.com subdomain |

## Quick Start

```bash
# Search hotels in New York
openweb booking exec searchHotels '{"ss":"New York","checkin":"2026-05-01","checkout":"2026-05-03"}'

# Get hotel details (extract country/slug from searchHotels URL)
openweb booking exec getHotelDetail '{"country":"us","slug":"riverside-tower","checkin":"2026-05-01","checkout":"2026-05-03"}'

# Get hotel reviews (hotel page must be open)
openweb booking exec getHotelReviews '{"slug":"riverside-tower"}'

# Get room pricing (hotel page must be open)
openweb booking exec getHotelPrices '{"slug":"riverside-tower"}'

# Search flights NYC to Paris
openweb booking exec searchFlights '{"route":"NYC-PAR","from":"NYC.CITY","to":"PAR.CITY","depart":"2026-05-01"}'
```

---

## Site Internals

## API Architecture
- **LD+JSON Hotel schema** on property detail pages: name, aggregateRating, description, address, image, priceRange
- **GraphQL at /dml/graphql** — used internally but not stable; not exposed as operations
- Search results use **data-testid** property cards with structured DOM
- Property details combine LD+JSON with DOM extraction for reviews, rooms
- Flights on **flights.booking.com** subdomain with **data-testid** flight cards
- Images hosted on **cf.bstatic.com** CDN

## Auth
No auth required for public browsing and search.

## Transport
- `transport: page` — browser-only access required
- Bot detection (likely PerimeterX) blocks direct HTTP requests
- All operations use the `booking-web` adapter for DOM/LD+JSON extraction
- Flights require navigating to flights.booking.com subdomain

## Known Issues
- **All ops require pre-navigation** — the adapter extracts from the current page DOM; the browser must already be on the correct URL (search results page for searchHotels, hotel detail page for getHotelDetail/getHotelReviews/getHotelPrices, flights page for searchFlights)
- **Dynamic pricing** — prices change based on dates, currency, and user session
- **Search results are first page only** — no pagination via adapter
- **Flights on separate subdomain** — flights.booking.com requires cross-domain navigation from www.booking.com
- **Review text partial** — featured reviews show excerpt; full text requires clicking "Read more"
