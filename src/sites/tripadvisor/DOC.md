# TripAdvisor

## Overview
Travel review and booking platform. Archetype: Travel.

## Target Intents
- [ ] Search hotels by location and dates
- [ ] Get hotel detail page (reviews, amenities, pricing)
- [ ] Get restaurant detail page (reviews, menu, photos)
- [ ] Get attraction reviews
- [ ] Search restaurants by location

## Workflows

### Find and compare hotels
1. `searchHotels(location, checkIn, checkOut)` → hotel list with `locationId`
2. `getHotel(locationId)` → full hotel detail, reviews, pricing

### Find restaurants
1. `searchRestaurants(location)` → restaurant list with `locationId`
2. `getRestaurant(locationId)` → full restaurant detail, reviews, menu

### Read attraction reviews
1. `getAttractionReviews(locationId)` → paginated reviews

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchHotels | find hotels in a location | location, checkIn, checkOut | name, rating, price, locationId | entry point |
| getHotel | hotel detail | locationId ← searchHotels | name, rating, reviews, amenities, pricing | |
| searchRestaurants | find restaurants in a location | location | name, rating, cuisine, locationId | entry point |
| getRestaurant | restaurant detail | locationId ← searchRestaurants | name, rating, reviews, menu, photos | |
| getAttractionReviews | reviews for an attraction | locationId | review text, rating, date, author | paginated |

## Quick Start

```bash
# Search hotels in New York
openweb tripadvisor exec searchHotels '{"location":"New York"}'

# Get hotel details
openweb tripadvisor exec getHotel '{"locationId":"123456"}'

# Search restaurants
openweb tripadvisor exec searchRestaurants '{"location":"Paris"}'
```

---

## Site Internals

## API Architecture
TripAdvisor uses a mix of:
- Internal GraphQL/REST APIs on `www.tripadvisor.com`
- LD+JSON structured data embedded in SSR HTML pages
- DataDome bot protection on all endpoints

## Auth
cookie_session expected. Public browsing works for read-only ops without login.

## Transport
Page transport likely required due to DataDome. Real Chrome profile needed.

## Known Issues
- **DataDome:** Aggressive bot detection. Must use real Chrome profile. Sessions should be short.
- **LD+JSON:** Product pages embed structured data as JSON-LD — may be viable extraction path.
