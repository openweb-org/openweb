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
