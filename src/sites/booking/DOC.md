# Booking.com

## Overview
Travel platform — hotel search, property details, reviews, room pricing, and flight search via Apollo SSR cache + LD+JSON + GraphQL page.evaluate + DOM.

## Workflows

### Find a hotel and check prices
1. `searchHotels(ss, checkin, checkout)` → pick hotel → `url` contains `/hotel/{country}/{slug}.html`
2. `getHotelDetail(country, slug)` → name, rating, address, description
3. `getHotelPrices(slug)` → room types, beds, sizes, facilities (requires hotel page open)
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

Everything below is for discover/compile operators and deep debugging.
Not needed for basic site usage.

## API Architecture
- **Apollo SSR cache** on search results pages: inline `<script type="application/json">` with `ROOT_QUERY.searchQueries` — full structured search results (512KB)
- **GraphQL at /dml/graphql** — `ReviewScoresQuery` for review category scores, `RoomDetailQuery` for room details/beds/facilities
- **LD+JSON Hotel schema** on property detail pages: name, aggregateRating, description, address, image, priceRange
- Search results use Apollo cache (primary) with DOM `data-testid` property cards (fallback)
- Property details combine LD+JSON with GraphQL for reviews and room data
- Flights on **flights.booking.com** subdomain with **data-testid** flight cards (DOM-only)
- Images hosted on **cf.bstatic.com** CDN

## Auth
No auth required for public browsing and search.

## Transport
- `transport: page` — browser-only access required
- Bot detection (PerimeterX) blocks direct HTTP requests from node
- `window.fetch` is native (not patched) — no client-side signing
- GraphQL queries via `page.evaluate(fetch('/dml/graphql'))` work cleanly
- Flights require navigating to flights.booking.com subdomain

## Extraction
- **searchHotels**: Apollo SSR cache extraction from inline JSON → zero DOM selectors
- **getHotelDetail**: LD+JSON `@type: Hotel` schema → zero DOM selectors
- **getHotelReviews**: GraphQL `ReviewScoresQuery` via page.evaluate(fetch) → zero DOM (with DOM fallback)
- **getHotelPrices**: GraphQL `RoomDetailQuery` via page.evaluate(fetch) → zero DOM (with DOM fallback)
- **searchFlights**: DOM extraction via `[data-testid]` selectors (flights API returns 403)

## Known Issues
- **PerimeterX bot detection** — all node HTTP requests blocked; page transport required
- **Flights API gated** — `flights.booking.com/api/flights/` returns 403 from all contexts
- **Dynamic pricing** — prices change based on dates, currency, and user session
- **Search results are first page only** — no pagination via adapter
- **Flights on separate subdomain** — flights.booking.com requires cross-domain navigation from www.booking.com
- **Room-level pricing** — GraphQL `RoomDetailQuery` returns room types/beds/facilities but not per-room prices (requires separate availability API); DOM fallback provides price when available
- **Localization** — Apollo cache and LD+JSON return localized data based on browser language
