# Home Depot

## Overview
Home improvement retailer (archetype: e-commerce). homedepot.com — product search and product details with specs/pricing via GraphQL federation gateway interception.

## Workflows

### Find and compare products
1. `searchProducts(keyword)` → browse results → `itemId`
2. `getProductDetail(itemId)` → full specs, price, availability

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search products by keyword | keyword | itemId, name, brand, price, rating, reviewCount | entry point; navigates to /s/{keyword} |
| getProductDetail | full product info | itemId <- searchProducts | name, brand, price, description, specs, images, availability | storeId/zipCode for local pricing |

## Quick Start

```bash
# Search for products
openweb homedepot exec searchProducts '{"keyword": "cordless drill"}'

# Get full product details by item ID
openweb homedepot exec getProductDetail '{"itemId": "306283873"}'

# Product detail with local store pricing
openweb homedepot exec getProductDetail '{"itemId": "306283873", "zipCode": "10001"}'
```

---

## Site Internals

## API Architecture
- **GraphQL interception** — searchProducts and getProductDetail use navigation-based interception of the GraphQL federation gateway (`/federation-gateway/graphql`)
- GraphQL operations fire naturally when navigating to search/product pages; the adapter intercepts responses via `page.waitForResponse()`
- This avoids Akamai blocking that affected the previous `page.evaluate(fetch(...))` approach

## Auth
- No auth required — all operations work on public data
- `requires_auth: false`

## Transport
- **All operations: page** — adapter runs inside managed browser
- searchProducts navigates to `/s/{keyword}` and intercepts the `searchModel` GraphQL response
- getProductDetail navigates to `/p/detail/{itemId}` and intercepts the `productClientOnlyProduct` GraphQL response

## Extraction
- **searchProducts**: Navigate to search page, intercept `searchModel` GraphQL response -> adapter maps `identifiers`, `pricing`, `reviews`, `media` into flat product objects
- **getProductDetail**: Navigate to product page, intercept `productClientOnlyProduct` GraphQL response -> adapter maps product fields, `specificationGroup` -> flat specs array, `taxonomy.breadCrumbs` -> labels

## Removed Operations
- **getStoreLocator** (removed) — URL pattern `/l/search/{zipCode}` is dead; returns an error page. DOM scraper picked up nav chrome garbage ("Store Finder") instead of store data. Requires fresh capture to re-implement.

## Known Issues
- **Expected DRIFT on product data** — prices, availability, and review counts change frequently; schema validates but fingerprint hashes change
