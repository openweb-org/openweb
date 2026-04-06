# Zillow

## Overview
Real estate marketplace. Search properties for sale by location, price, and filters.

## Workflows

### Search properties in a city
1. `searchProperties(mapBounds, regionSelection, filterState)` → property listings

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProperties | find properties for sale | mapBounds, regionSelection, filterState | listings: address, price, beds, baths, sqft, zestimate, photos, lat/lng | entry point, returns ~41 results |

## Quick Start

```bash
# Search San Francisco (regionId 20330)
openweb zillow exec searchProperties '{"searchQueryState":{"pagination":{},"isMapVisible":true,"mapBounds":{"north":37.82,"south":37.70,"east":-122.35,"west":-122.52},"filterState":{"sortSelection":{"value":"globalrelevanceex"},"isAllHomes":{"value":true}},"isListVisible":true,"regionSelection":[{"regionId":20330,"regionType":6}],"category":"cat1"},"wants":{"cat1":["listResults"]},"requestId":1}'

# Search Los Angeles (regionId 12447)
openweb zillow exec searchProperties '{"searchQueryState":{"pagination":{},"isMapVisible":true,"mapBounds":{"north":34.34,"south":33.70,"east":-117.89,"west":-118.93},"filterState":{"sortSelection":{"value":"globalrelevanceex"},"isAllHomes":{"value":true}},"isListVisible":true,"regionSelection":[{"regionId":12447,"regionType":6}],"category":"cat1"},"wants":{"cat1":["listResults"]},"requestId":1}'

# Search Seattle with price/bed filters (regionId 16037)
openweb zillow exec searchProperties '{"searchQueryState":{"pagination":{},"isMapVisible":true,"mapBounds":{"north":47.74,"south":47.48,"east":-122.08,"west":-122.61},"filterState":{"sortSelection":{"value":"globalrelevanceex"},"isAllHomes":{"value":true},"price":{"min":500000,"max":1000000},"beds":{"min":3}},"isListVisible":true,"regionSelection":[{"regionId":16037,"regionType":6}],"category":"cat1"},"wants":{"cat1":["listResults"]},"requestId":1}'
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

## API Architecture
- Next.js SSR app — primary data delivered via `__NEXT_DATA__` (418KB)
- `PUT /async-create-search-page-state` is the SPA search API
- GraphQL endpoint at `/zg-graph` (used for user profile, not search)

## Auth
- `cookie_session` — PerimeterX requires a valid browser session; search API returns 403 without one
- Login via `openweb login zillow`, then `openweb browser restart`
- No CSRF required for search

## Transport
- `page` — PerimeterX bot detection blocks all node HTTP
- Must use headed browser with real Chrome profile

## Known Issues
- **PerimeterX**: CAPTCHA challenge on headless browsers. Use `openweb browser restart --no-headless`, solve the CAPTCHA, then retry
- Response is ~200KB+ per search — auto-spills to temp file
- `regionId` is required but not easily discoverable — use known IDs or the autocomplete API
