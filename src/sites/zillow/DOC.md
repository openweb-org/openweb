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
| searchProperties | find properties for sale | mapBounds, regionSelection, filterState | listings: address, price, beds, baths, sqft, zestimate, photos, lat/lng | entry point, returns ~41 results |
| getPropertyDetail | get full property details | zpid, slug | address, price, beds, baths, sqft, photos, description, Zestimate, year built | adapter: __NEXT_DATA__ extraction |
| getZestimate | get home value estimate | zpid, slug | zestimate, rentZestimate, confidence range, tax assessment, history | adapter: __NEXT_DATA__ extraction |
| getNeighborhood | get neighborhood data | zpid, slug | schools, walkScore, transitScore, bikeScore, nearby homes | adapter: __NEXT_DATA__ extraction |

## Quick Start

```bash
# Search San Francisco (regionId 20330)
openweb zillow exec searchProperties '{"searchQueryState":{"pagination":{},"isMapVisible":true,"mapBounds":{"north":37.82,"south":37.70,"east":-122.35,"west":-122.52},"filterState":{"sortSelection":{"value":"globalrelevanceex"},"isAllHomes":{"value":true}},"isListVisible":true,"regionSelection":[{"regionId":20330,"regionType":6}],"category":"cat1"},"wants":{"cat1":["listResults"]},"requestId":1}'

# Get property details by zpid
openweb zillow exec getPropertyDetail '{"zpid":"2077416986","slug":"_"}'

# Get Zestimate for a property
openweb zillow exec getZestimate '{"zpid":"2077416986","slug":"_"}'

# Get neighborhood data
openweb zillow exec getNeighborhood '{"zpid":"2077416986","slug":"_"}'
```

### Common Region IDs

| City | regionId |
|------|----------|
| San Francisco | 20330 |
| Los Angeles | 12447 |
| Seattle | 16037 |
| New York | 6181 |
| Chicago | 17426 |

---

## Site Internals

### API Architecture
- Next.js SSR app — primary data delivered via `__NEXT_DATA__` (418KB)
- `PUT /async-create-search-page-state` is the SPA search API
- Property detail pages embed all data in `__NEXT_DATA__` (no separate API call needed)
- GraphQL endpoint at `/zg-graph` (used for user profile, not search)

### Auth
- `cookie_session` — PerimeterX requires a valid browser session; search API returns 403 without one
- Login via `openweb login zillow`, then `openweb browser restart`
- No CSRF required for search or detail pages

### Transport
- `page` — PerimeterX bot detection blocks all node HTTP
- Must use headed browser with real Chrome profile
- Detail operations use adapter with page navigation to `/homedetails/{slug}/{zpid}_zpid/`

### Known Issues
- **PerimeterX**: CAPTCHA challenge on headless browsers. Use `openweb browser restart --no-headless`, solve the CAPTCHA, then retry
- Response is ~200KB+ per search — auto-spills to temp file
- `regionId` is required but not easily discoverable — use known IDs or the autocomplete API
- Property detail `__NEXT_DATA__` can be 200KB+ — adapter extracts only relevant fields
- `slug` parameter is optional for detail ops — use `"_"` if unknown, Zillow redirects to correct URL
