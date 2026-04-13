# TripAdvisor

## Overview
Travel review and booking platform. Archetype: Travel. Adapter-only site — all data extracted from LD+JSON structured data and DOM on SSR pages.

## Workflows

### Search hotels in a city
1. `searchLocation(query)` → pick location → `geoId`, `locationSlug`
2. `searchHotels(geoId, location)` → hotel list with names, ratings, addresses

### Get hotel detail
1. `searchLocation(query)` → `geoId`
2. `searchHotels(geoId, location)` → pick hotel → extract `locationId` and `slug` from URL
3. `getHotelDetail(geoId, locationId, slug)` → name, rating, amenities, star rating, price range, check-in/out

### Search restaurants in a city
1. `searchLocation(query)` → pick location → `geoId`, `locationSlug`
2. `searchRestaurants(geoId, location)` → restaurant list with names, ratings, cuisine, price range

### Get restaurant detail
1. `searchLocation(query)` → `geoId`
2. `getRestaurant(geoId, locationId, slug)` → name, cuisine, rating, hours, address, menu URL

### Get attraction detail
1. `searchLocation(query)` → `geoId`
2. `getAttractionDetail(geoId, locationId, slug)` → name, rating, description, hours, address

### Read attraction reviews
1. `searchLocation(query)` → `geoId`
2. `getAttractionReviews(geoId, locationId, slug)` → attraction info + review titles, text, dates

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchLocation | find geoId for a city/region | query | geoId, locationSlug, type | entry point; uses TypeAheadJson API |
| searchHotels | list hotels in a city | geoId ← searchLocation, location ← locationSlug | name, rating, reviewCount, priceRange, address | LD+JSON `ItemList`/`Hotel`/`LodgingBusiness` + DOM fallback |
| getHotelDetail | hotel detail page | geoId ← searchLocation, locationId, slug | name, rating, amenities, starRating, priceRange, checkin/out | LD+JSON `Hotel`/`LodgingBusiness` |
| searchRestaurants | list restaurants in a city | geoId ← searchLocation, location ← locationSlug | name, rating, cuisine, priceRange, address | LD+JSON `ItemList`/`Restaurant` + DOM fallback |
| getRestaurant | restaurant detail | geoId ← searchLocation, locationId, slug | name, cuisine, rating, reviewCount, hours, menuUrl | LD+JSON `Restaurant`/`FoodEstablishment`/`LocalBusiness` |
| getAttractionDetail | attraction detail page | geoId ← searchLocation, locationId, slug | name, description, rating, hours, address | LD+JSON `TouristAttraction`/`LocalBusiness` |
| getAttractionReviews | attraction info + reviews | geoId ← searchLocation, locationId, slug | name, rating, reviewCount, reviews[] | LD+JSON + DOM `[data-reviewid]`/`[data-test-target]` |

**Parameter format:**
- `geoId` — TripAdvisor numeric geo ID (e.g. `60763` = New York City, `187147` = Paris)
- `locationId` — numeric ID from the URL (e.g. `d457808` → `457808`)
- `location` / `slug` — URL path segment (e.g. `New_York_City_New_York`, `Le_Bernardin-New_York_City_New_York`)

## Quick Start

```bash
# Find geoId for a city
openweb tripadvisor exec searchLocation '{"query":"Tokyo"}'

# Search hotels (use geoId and locationSlug from searchLocation)
openweb tripadvisor exec searchHotels '{"geoId":"298184","location":"Tokyo_Tokyo_Prefecture_Kanto"}'

# Get hotel detail
openweb tripadvisor exec getHotelDetail '{"geoId":"60763","locationId":"93450","slug":"The_Plaza-New_York_City_New_York"}'

# Search restaurants
openweb tripadvisor exec searchRestaurants '{"geoId":"60763","location":"New_York_City_New_York"}'

# Get restaurant detail
openweb tripadvisor exec getRestaurant '{"geoId":"60763","locationId":"457808","slug":"Le_Bernardin-New_York_City_New_York"}'

# Get attraction detail
openweb tripadvisor exec getAttractionDetail '{"geoId":"60763","locationId":"104365","slug":"Statue_of_Liberty-New_York_City_New_York"}'

# Get attraction reviews
openweb tripadvisor exec getAttractionReviews '{"geoId":"60763","locationId":"104365","slug":"Statue_of_Liberty-New_York_City_New_York"}'
```
