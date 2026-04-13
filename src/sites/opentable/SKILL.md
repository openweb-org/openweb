# OpenTable

## Overview
Restaurant reservation platform — search restaurants, view details and reviews, check reservation availability. Commerce archetype.

## Workflows

### Find and book a restaurant
1. `searchRestaurants(term, location)` → restaurant list with `restaurantId`, `slug`
2. `getRestaurant(slug)` → full details (hours, cuisine, ratings, address)
3. `getAvailability(restaurantId, date, time, partySize)` → available time slots

### Read restaurant reviews
1. `searchRestaurants(term, location)` → pick restaurant → `restaurantId`
2. `getReviews(restaurantId, page)` → paginated reviews (10/page)

### Search with availability
1. `searchRestaurants(term, location, date, time, covers)` → restaurants in the area
2. `getAvailability(restaurantId, date, time, partySize)` → time slots for specific restaurant

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchRestaurants | find restaurants | term, location | restaurantId, name, slug, cuisine, rating, neighborhood | entry point; adapter (browser) |
| getRestaurant | restaurant details | slug ← searchRestaurants | name, cuisine, ratings, hours, address, description, photos | adapter (browser) |
| getAvailability | check time slots | restaurantId ← searchRestaurants, date, time, partySize | slots with timeOffsetMinutes, seatingTypes | GraphQL via page |
| getReviews | customer reviews | restaurantId ← searchRestaurants, page | reviewId, rating, text, displayName, dinedDate | paginated (10/page); GraphQL via page |

## Quick Start

```bash
# Search for Italian restaurants in San Francisco
openweb opentable exec searchRestaurants '{"term": "italian", "location": "San Francisco"}'

# Get restaurant details
openweb opentable exec getRestaurant '{"slug": "ceron-kitchen-alameda"}'

# Check availability for 2 people
openweb opentable exec getAvailability '{"restaurantId": 1204381, "date": "2026-04-12", "time": "19:00", "partySize": 2}'

# Read reviews (page 1, newest first)
openweb opentable exec getReviews '{"restaurantId": 1204381, "page": 1}'
```
