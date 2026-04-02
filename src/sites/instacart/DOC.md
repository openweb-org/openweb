# Instacart

## Overview
Grocery delivery marketplace. Archetype: Food Delivery.

## Workflows

### Search and browse products
1. `searchProducts(query)` → product names, prices, brands
2. Pick a store from results → use `retailerSlug` with `getStoreProducts`

### Browse a store's catalog
1. `getNearbyStores(postalCode)` → available stores with `retailerId`
2. `getStoreProducts(retailerSlug, slug)` → products in a department

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search groceries by keyword | query | products (name, price, brand, availability) | entry point; also returns autocomplete suggestions |
| getStoreProducts | browse products in a store department | retailerSlug ← store name, slug ← category | products (name, price, brand), collection info | auto-resolves shopId from retailerSlug |
| getNearbyStores | find stores with delivery ETAs | postalCode | stores (retailerId, etaMinutes, etaDisplay) | entry point; location-dependent |

## Quick Start

```bash
# Search for groceries
openweb instacart exec searchProducts '{"query": "bananas", "limit": 5}'

# Browse Costco produce
openweb instacart exec getStoreProducts '{"retailerSlug": "costco", "slug": "produce", "first": 10}'

# Find nearby stores
openweb instacart exec getNearbyStores '{"postalCode": "90210"}'
```

---

## Site Internals

## API Architecture
- **GraphQL with persisted queries** — all API traffic is GET with `operationName`, `variables`, and `extensions` (sha256Hash) as URL query params
- Full query strings rejected (`PersistedQueryNotSupported`) — only hashed queries accepted
- Apollo Client APQ format
- Hashes are deployment-specific and may change with Instacart releases
- Price data is deeply nested: `item.price.viewSection.itemCard.priceString`

## Auth
- **cookie_session** — user location/zone set via cookies and IP geolocation
- Most read operations work without login (guest access)
- Zone/location determined by cookies and IP geolocation

## Transport
- **page** (L3 adapter) — adapter uses `page.evaluate(fetch(..., { credentials: 'include' }))` for GraphQL queries
- searchProducts uses page navigation + response interception for Items query
- getStoreProducts navigates to store page to auto-resolve shopId, then uses direct GraphQL
- Any Instacart page must be open (`instacart.com/*`)

## Known Issues
- Persisted query hashes change with Instacart deployments — hashes may need periodic updates
- searchProducts is slower than direct API calls due to page navigation for Items interception
- Results are location-dependent based on IP geolocation and cookies
- getStoreProducts auto-resolves shopId by navigating to the store page, adding latency on first call
