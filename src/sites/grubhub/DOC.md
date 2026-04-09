# Grubhub

## Overview
Grubhub is a food delivery platform (archetype: Food Delivery). Search restaurants, browse menus with prices, and check delivery time/fee estimates.

## Workflows

### Find restaurants and browse menu
1. `searchRestaurants(latitude, longitude, searchTerm)` → pick restaurant → `restaurantId`
2. `getMenu(restaurantId)` → categories with items and prices

### Check delivery details
1. `searchRestaurants(latitude, longitude)` → pick restaurant → `restaurantId`
2. `getDeliveryEstimate(restaurantId)` → delivery time, fee, order minimum

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchRestaurants | find restaurants near a location | latitude, longitude, searchTerm? | restaurantId, name, rating, deliveryFee, deliveryEstimate | entry point; paginated |
| getMenu | browse restaurant menu | restaurantId ← searchRestaurants | categories, items with prices | full menu with descriptions |
| getDeliveryEstimate | check delivery time and fees | restaurantId ← searchRestaurants | deliveryEstimateMin/Max, deliveryFee, orderMinimum | includes pickup estimates |

## Quick Start

```bash
# Search for pizza near Midtown Manhattan
openweb grubhub exec searchRestaurants '{"latitude": 40.7484, "longitude": -73.9857, "searchTerm": "pizza"}'

# Get a restaurant's menu
openweb grubhub exec getMenu '{"restaurantId": "64436"}'

# Check delivery estimate
openweb grubhub exec getDeliveryEstimate '{"restaurantId": "64436"}'
```

---

## Site Internals

### API Architecture
- REST API at `api-gtm.grubhub.com`
- Search: `GET /restaurants/search/search_listing` with lat/lng/searchTerm query params
- Detail/Menu: `GET /restaurants/{id}` with feature flag query params

### Auth
- No login required for read operations
- Cookie session for browser context (managed automatically)
- No CSRF required on GET endpoints

### Transport
- `page` — heavy bot detection (Cloudflare + PerimeterX + DataDome) requires browser context
- All operations use `pageFetch` via `page.evaluate(fetch)` with `credentials: 'include'`
- Adapter: `adapters/grubhub.ts`

### Extraction
- All operations: JSON from internal REST API responses via `pageFetch`
- Search: `results[]` array with nested rating/fee/estimate objects
- Menu: `restaurant.menu_category_list[]` with nested `menu_item_list[]`
- Delivery: `restaurant_availability` with fee/estimate sub-objects
- Prices in cents (USD), converted to dollars by adapter

### Known Issues
- Bot detection: Cloudflare (`cf_clearance`), PerimeterX (`_px3`), DataDome (`datadome`) — all present
- Search requires valid lat/lng coordinates for a delivery area
- Delivery estimates are real-time and may vary between requests
