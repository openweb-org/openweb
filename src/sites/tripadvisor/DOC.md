# TripAdvisor

## Overview
Travel review and booking platform. Archetype: Travel. Adapter-only site — all data extracted from LD+JSON structured data and DOM on SSR pages.

## Workflows

### Search hotels in a city
1. `searchLocation(query)` → pick location → `geoId`, `locationSlug`
2. `searchHotels(geoId, location)` → hotel list with names, ratings, addresses

### Get restaurant detail
1. `searchLocation(query)` → `geoId`
2. `getRestaurant(geoId, locationId, slug)` → name, cuisine, rating, hours, address, menu URL

### Read attraction reviews
1. `searchLocation(query)` → `geoId`
2. `getAttractionReviews(geoId, locationId, slug)` → attraction info + review titles, text, dates

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchLocation | find geoId for a city/region | query | geoId, locationSlug, type | entry point; uses /Search URL |
| searchHotels | list hotels in a city | geoId ← searchLocation, location ← locationSlug | name, rating, reviewCount, priceRange, address | LD+JSON `ItemList`/`Hotel`/`LodgingBusiness` + DOM fallback |
| getRestaurant | restaurant detail | geoId ← searchLocation, locationId, slug | name, cuisine, rating, reviewCount, hours, menuUrl | LD+JSON `Restaurant`/`FoodEstablishment`/`LocalBusiness` |
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

# Get restaurant detail
openweb tripadvisor exec getRestaurant '{"geoId":"60763","locationId":"457808","slug":"Le_Bernardin-New_York_City_New_York"}'

# Get attraction reviews
openweb tripadvisor exec getAttractionReviews '{"geoId":"60763","locationId":"104365","slug":"Statue_of_Liberty-New_York_City_New_York"}'
```

---

## Site Internals

## API Architecture
TripAdvisor embeds rich LD+JSON structured data in SSR HTML pages:
- Hotel search pages: `ItemList` with `Hotel` items (name, rating, address, priceRange)
- Restaurant detail pages: `FoodEstablishment` (name, cuisine, hours, rating, address)
- Attraction detail pages: `LocalBusiness` (name, rating, address) + DOM review cards
- DataDome bot protection blocks all direct HTTP/fetch — requires real browser

## Auth
No auth required. All operations read public data.

## Transport
Page transport (real Chrome via CDP). DataDome blocks node transport entirely.

## Extraction
- **searchLocation**: `/Search?q=...` page → parse geoId and slug from result links
- **searchHotels**: LD+JSON `ItemList` → `itemListElement[].item` (type `Hotel`/`LodgingBusiness`), DOM `[data-automation="hotel-card-title"]` fallback
- **getRestaurant**: LD+JSON `Restaurant`/`FoodEstablishment`/`LocalBusiness` from `<script type="application/ld+json">`
- **getAttractionReviews**: LD+JSON for attraction info + DOM reviews via `[data-reviewid]`, `[data-test-target="review-title"]`, `[data-automation*="reviewText"]`

## Known Issues
- **DataDome:** Aggressive bot detection on all endpoints. Must use page transport with real Chrome profile. If captcha appears, solve it manually in the headed browser, then retry.
- **Review ratings:** Bubble ratings extracted from CSS class `ui_bubble_rating bubble_N` when available.
- **Selector fragility:** TripAdvisor frequently changes DOM structure. Adapter uses tiered fallbacks (LD+JSON → specific data attributes → generic DOM) to reduce breakage.
