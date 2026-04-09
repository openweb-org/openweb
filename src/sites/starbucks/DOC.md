# Starbucks

## Overview
Coffee chain (archetype: food/retail). starbucks.com — store finder, store details, and menu browsing via BFF API proxy interception.

## Workflows

### Find nearby stores
1. `searchStores(lat, lng)` → nearby stores with distance, hours, amenities → `storeNumber`, `latitude`, `longitude`

### Get store details
1. `searchStores(lat, lng)` → `storeNumber`, `latitude`, `longitude`
2. `getStoreDetail(storeNumber, lat, lng)` ← searchStores → full schedule, amenities, mobile ordering status

### Browse menu
1. `getMenu()` → categories, subcategories, products with sizes and availability

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchStores | find nearby stores | lat, lng | storeNumber, name, distance, address, hours, amenities | returns up to 50 stores sorted by distance |
| getStoreDetail | full store info | storeNumber ← searchStores, lat ← searchStores, lng ← searchStores | schedule, amenities, mobileOrdering, address, coordinates | uses nearby search + filter |
| getMenu | browse menu | (none) | categories, products, sizes, availability | featured products populated; most subcategories list structure only |

## Quick Start

```bash
# Find stores near San Francisco
openweb starbucks exec searchStores '{"lat": 37.7749, "lng": -122.4194}'

# Get full detail for a specific store
openweb starbucks exec getStoreDetail '{"storeNumber": "53646-283069", "lat": 37.7772, "lng": -122.4193}'

# Get the menu
openweb starbucks exec getMenu '{}'
```

---

## Site Internals

### API Architecture
- **BFF API proxy** at `/apiproxy/v1/` — server-rendered backend-for-frontend
- Store locator: `GET /apiproxy/v1/locations?lat=&lng=` (requires `X-Requested-With: XMLHttpRequest`)
- Menu: `GET /apiproxy/v1/ordering/menu` (no special headers)
- No store detail endpoint — detail derived from search results by storeNumber filter

### Auth
- No auth required for read operations
- `requires_auth: false`

### Transport
- **All operations: page** — browser-context fetch via pageFetch
- Store API requires `X-Requested-With: XMLHttpRequest` header (returns 400 without it)
- Menu API works without special headers

### Bot Detection
- Heavy: Cloudflare (`cf_clearance`), Akamai (`_abck`), PerimeterX (`_px3`, `_pxhd`), DataDome (`datadome`)
- Patchright headless bypasses all four layers
- Direct HTTP (curl/node fetch) will fail

### Known Issues
- Menu API returns products only for featured/trending subcategories; most subcategories return structure without product listings
- No dedicated store detail endpoint; getStoreDetail requires approximate coordinates from prior searchStores call
- Store API returns max 50 stores per query
