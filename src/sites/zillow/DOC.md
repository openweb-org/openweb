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

---

## Site Internals

### API Architecture
- Next.js SSR app with GraphQL API at `/graphql` using Apollo persisted queries
- `gdpClientCache` in `__NEXT_DATA__` contains the same data as the GraphQL response (118+ fields)
- Search results available in `searchPageState.cat1` within `__NEXT_DATA__`

### Auth
- `cookie_session` — PerimeterX requires a valid browser session; all endpoints return 403 without one
- No login required for public property data (`requires_auth: false`)

### Transport
- `page` — all 4 ops use adapter (`adapters/zillow-detail.ts`) with `__NEXT_DATA__` extraction
- **GraphQL API (`/graphql/`) is fully blocked by PerimeterX** — both `page.evaluate(fetch())` and `page.request.fetch()` return 403 with CAPTCHA HTML. Only page navigation works.
- searchProperties also uses adapter (page navigation to search URL + `__NEXT_DATA__`)
- Property data cached per-zpid within adapter — getPropertyDetail/getZestimate/getNeighborhood share one navigation

### Extraction
- All ops: navigate to target URL → extract `script#__NEXT_DATA__` → parse `gdpClientCache` (property ops) or `searchPageState` (search)
- Property cache key pattern: `NotForSalePriorityQuery{...}` → `value.property` contains 118+ fields
- Schools, nearbyHomes, taxHistory may be null in SSR data (lazy-loaded via secondary GraphQL queries)

### PerimeterX Handling (adapter pattern)
- Initial page load after browser start triggers CAPTCHA — verify warm-up poisons the PX session
- **Reset pattern**: navigate to `about:blank` → `context.clearCookies()` → wait 1s → retry navigation
- Up to 4 retry attempts per navigation; first 1-2 attempts typically CAPTCHA, subsequent succeed
- `adapter.init()` clears cookies if current page is CAPTCHA (handles warm-up poisoning)
- `propertyCache` avoids re-navigation when multiple ops target the same zpid

### Known Issues
- **PerimeterX**: Aggressive CAPTCHA on all requests including GraphQL API. The adapter handles retries automatically via the about:blank cookie reset pattern. Sessions degrade after ~10 minutes of inactivity.
- `walkScore`, `transitScore`, `bikeScore` return null — not in SSR initial data (lazy-loaded)
- `schools`, `nearbyHomes`, `taxHistory`, `description` may be null for some properties (not in initial SSR query)
- `regionId` is required for search but not easily discoverable — use known IDs
- `slug` parameter is cosmetic — use `"_"` if unknown, Zillow redirects to correct URL
