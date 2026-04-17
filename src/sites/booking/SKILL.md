# Booking.com

## Overview
Travel platform — hotel search, property details, reviews, room pricing, and flight search via Apollo SSR cache + LD+JSON + GraphQL page.evaluate + DOM.

## Workflows

### Find a hotel and check prices
1. `searchHotels(ss, checkin, checkout)` → `hotels[].url` — parse URL `/hotel/{country}/{slug}.html` → `country`, `slug`
2. `getHotelDetail(country, slug)` ← searchHotels url → name, rating, address, description
3. `getHotelPrices(slug)` ← searchHotels url → room types, beds, sizes, facilities (requires hotel page open)
4. `getHotelReviews(slug)` ← searchHotels url → score, subscores, featured reviews (requires hotel page open)

### Search flights
1. `searchFlights(route, from, to, depart)` → carriers, times, duration, stops, prices

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchHotels | find hotels in a destination | ss (query), checkin, checkout | name, url, price, rating, reviewCount | entry point; parse url → country, slug |
| getHotelDetail | hotel info by URL | country ← searchHotels url, slug ← searchHotels url | raw schema.org/Hotel LD+JSON (name, aggregateRating, address, image, priceRange) | declarative `script_json` extraction with `type_filter: Hotel` — response is the raw LD+JSON block, not reshaped |
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

## getHotelDetail response shape

`getHotelDetail` returns the raw schema.org `Hotel` JSON-LD block as-is. Pretty-name mappings (what the old adapter exposed → raw field path):

| Friendly name | Raw JSON-LD path |
|---|---|
| rating | `aggregateRating.ratingValue` (out of 10 on Booking.com) |
| reviewCount | `aggregateRating.reviewCount` |
| street | `address.streetAddress` |
| city | `address.addressLocality` |
| region | `address.addressRegion` |
| postalCode | `address.postalCode` |
| country | `address.addressCountry` |
| image | `image` (string or array of URLs) |
| priceRange | `priceRange` |

No runtime reshape — consumers read fields by their schema.org names.
