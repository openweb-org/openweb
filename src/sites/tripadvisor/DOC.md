# TripAdvisor

## Overview
Travel reviews platform. Hotel, restaurant, and attraction search, details, reviews, and pricing via browser DOM/LD+JSON extraction from tripadvisor.com.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchHotels | search hotels in a destination | GET /Hotels-g{geoId}-{slug}-Hotels.html | hotel names, links, ratings from listing page |
| getHotelDetail | hotel info by location ID | GET /Hotel_Review-g{geoId}-d{locationId}-Reviews-{slug}.html | LD+JSON LodgingBusiness: name, rating, reviewCount, priceRange, address, amenities |
| getHotelReviews | hotel review summary | internal (same page as detail) | rating breakdown, sub-ratings (rooms, service, value), AI summary |
| getHotelPrices | hotel pricing/deals | internal (same page as detail) | current price, deal count, lowest deal from booking partners |
| searchRestaurants | search restaurants in a destination | GET /Restaurants-g{geoId}-{slug}.html | restaurant names, links from listing page |
| getRestaurantDetail | restaurant info by location ID | GET /Restaurant_Review-g{geoId}-d{locationId}-Reviews-{slug}.html | name, rating, cuisine, priceRange, address |
| getRestaurantReviews | restaurant review summary | internal (same page as detail) | rating breakdown, sub-ratings (food, service, value, atmosphere), AI summary |
| searchAttractions | search attractions in a destination | GET /Attractions-g{geoId}-Activities-{slug}.html | attraction names, links from listing page |
| getAttractionDetail | attraction info by location ID | GET /Attraction_Review-g{geoId}-d{locationId}-Reviews-{slug}.html | LD+JSON LocalBusiness: name, rating, reviewCount, address, hours, geo |
| searchAll | cross-category search | GET /Search?q={query} | hotels, restaurants, attractions, destinations |

## API Architecture
- **No public REST/GraphQL API** — TripAdvisor uses hashed GraphQL queries at `/data/graphql/ids` with no stable operation names
- All data extracted from **browser-rendered DOM** and **LD+JSON** structured data
- Hotel details from `LodgingBusiness` LD+JSON schema
- Attraction details from `LocalBusiness` LD+JSON schema
- Restaurant details from DOM (no dedicated LD+JSON type on detail pages)
- Listings extracted from `a[href*="Hotel_Review"]` / `a[href*="Restaurant_Review"]` / `a[href*="Attraction_Review"]` links

## Auth
- No auth needed for public browsing
- `requires_auth: false`

## Transport
- `transport: page` — browser-only access required
- **DataDome** bot detection blocks all direct HTTP requests
- All operations use the `tripadvisor-web` adapter for DOM extraction

## Extraction
- **LD+JSON**: Hotel detail (LodgingBusiness), Attraction detail (LocalBusiness)
- **DOM selectors**: `data-automation="bubbleRatingValue"`, `data-automation="bubbleReviewCount"`, `data-automation="finalPrice"`, `data-automation="ugcRedesign"`
- **Link patterns**: `/Hotel_Review-g{geoId}-d{locationId}-Reviews-{slug}.html`

## Known Issues
- **Listings are partial** — hotel/restaurant/attraction listings return only the first page of results (no pagination via adapter)
- **Review text not extracted** — individual review text is loaded dynamically; adapter extracts summary/breakdown only
- **Restaurant LD+JSON** — restaurant detail pages sometimes lack Restaurant-typed LD+JSON; falls back to DOM extraction
- **Dynamic pricing** — hotel prices change based on dates; adapter captures the default undated price
- **Geo IDs** — not easily discoverable; use the search operation or known IDs (60763=NYC, 187147=Paris, 186338=London)
