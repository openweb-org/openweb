# Zillow

## Overview
Real estate marketplace. Search properties, get full property details, Zestimates, and neighborhood data.

## Workflows

### Search properties in a city
1. `searchProperties(mapBounds, regionSelection, filterState)` → property listings with zpid

### Get full details for a property
1. `searchProperties(...)` → get `zpid` from results
2. `getPropertyDetail(zpid)` → address, price, beds, baths, sqft, photos, description, Zestimate

### Check home value estimate
1. `getZestimate(zpid)` → current Zestimate, rent estimate, confidence range, history

### Research a neighborhood
1. `getNeighborhood(zpid)` → schools, walk/transit/bike scores, nearby comparable homes

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProperties | find properties for sale | mapBounds, regionSelection, filterState | listings: address, price, beds, baths, sqft, zestimate, photos, lat/lng | entry point; adapter: search page __NEXT_DATA__ |
| getPropertyDetail | get full property details | zpid, slug | address, price, beds, baths, sqft, photos, description, Zestimate, year built | adapter: property page __NEXT_DATA__ |
| getZestimate | get home value estimate | zpid, slug | zestimate, rentZestimate, confidence range, tax assessment | adapter: property page __NEXT_DATA__ |
| getNeighborhood | get neighborhood data | zpid, slug | schools, walkScore, transitScore, bikeScore, nearby homes | adapter: property page __NEXT_DATA__; scores may be null |

## Quick Start

```bash
# Search San Francisco (regionId 20330)
openweb zillow exec searchProperties '{"searchQueryState":{"pagination":{},"isMapVisible":true,"mapBounds":{"north":37.82,"south":37.70,"east":-122.35,"west":-122.52},"filterState":{"sortSelection":{"value":"globalrelevanceex"},"isAllHomes":{"value":true}},"isListVisible":true,"regionSelection":[{"regionId":20330,"regionType":6}],"category":"cat1"},"wants":{"cat1":["listResults"]},"requestId":1}'

# Get property details by zpid
openweb zillow exec getPropertyDetail '{"zpid":"15076238","slug":"1000-Fell-St-San-Francisco-CA-94117"}'

# Get Zestimate for a property
openweb zillow exec getZestimate '{"zpid":"15076238","slug":"1000-Fell-St-San-Francisco-CA-94117"}'

# Get neighborhood data
openweb zillow exec getNeighborhood '{"zpid":"15076238","slug":"1000-Fell-St-San-Francisco-CA-94117"}'
```

### Common Region IDs

| City | regionId |
|------|----------|
| San Francisco | 20330 |
| Los Angeles | 12447 |
| Seattle | 16037 |
| New York | 6181 |
| Chicago | 17426 |
