# Redfin

## Overview
Real estate marketplace — search homes for sale, view property details, and check housing market data.

## Workflows

### Search and explore properties
1. `searchHomes(regionId, state, city)` → `url`, `streetAddress`, `price`, `sqft`
2. Parse listing `url` → `state`, `city`, `address`, `propertyId`
3. `getPropertyDetails(state, city, address, propertyId)` → beds, baths, sqft, price, amenities, photos

### Check market conditions
1. `getMarketData(regionId, state, city)` → `medianSalePrice`, `homesSold`, `medianDaysOnMarket`, `competitiveness`

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchHomes | Search homes by city | regionId, state, city | listings with url, price, address, sqft | entry point; Stingray GIS API; 20 homes per page |
| getPropertyDetails | Full property detail | state, city, address, propertyId ← searchHomes `url` | beds, baths, sqft, price, amenities, photos | JSON-LD from fetched HTML |
| getMarketData | Housing market stats | regionId, state, city | medianSalePrice, homesSold, medianDaysOnMarket, competitiveness | entry point; HTML text regex extraction |

## Quick Start

```bash
# Search homes in Seattle
openweb redfin exec searchHomes '{"regionId":"16163","state":"WA","city":"Seattle"}'

# Get property details (use URL parts from search results)
openweb redfin exec getPropertyDetails '{"state":"WA","city":"Seattle","address":"1546-Sturgus-Ave-S-98144","propertyId":"22392812"}'

# Get Seattle housing market data
openweb redfin exec getMarketData '{"regionId":"16163","state":"WA","city":"Seattle"}'
```
