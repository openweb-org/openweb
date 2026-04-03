# Home Depot

## Overview
Home improvement retailer (archetype: e-commerce). homedepot.com — product search, product details with specs/pricing, and store locator via GraphQL federation gateway and DOM extraction.

## Workflows

### Find and compare products
1. `searchProducts(keyword)` → browse results → `itemId`
2. `getProductDetail(itemId)` → full specs, price, availability

### Check local store availability
1. `getStoreLocator(zipCode)` → nearby stores with hours and phone
2. `getProductDetail(itemId, storeId)` → store-specific pricing/availability

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search products by keyword | keyword | itemId, name, brand, price, rating, reviewCount | entry point; paginated (pageSize, startIndex) |
| getProductDetail | full product info | itemId ← searchProducts | name, brand, price, description, specs, images, availability | storeId/zipCode for local pricing |
| getStoreLocator | find nearby stores | zipCode | name, address, phone, hours, distance | entry point; DOM extraction |

## Quick Start

```bash
# Search for products
openweb homedepot exec searchProducts '{"keyword": "cordless drill"}'

# Get full product details by item ID
openweb homedepot exec getProductDetail '{"itemId": "306283873"}'

# Product detail with local store pricing
openweb homedepot exec getProductDetail '{"itemId": "306283873", "zipCode": "10001"}'

# Find nearby stores
openweb homedepot exec getStoreLocator '{"zipCode": "90210"}'
```

---

## Site Internals

## API Architecture
- **Hybrid** — searchProducts and getProductDetail use the GraphQL federation gateway (`/federation-gateway/graphql`); getStoreLocator uses page-level DOM extraction
- GraphQL operations are executed via `page.evaluate(fetch(...))` inside the managed browser to inherit session cookies and anti-bot state
- The federation gateway requires specific headers: `x-experience-name`, `x-debug`, `x-current-url`

## Auth
- No auth required — all operations work on public data
- `requires_auth: false`

## Transport
- **All operations: page** — adapter runs inside managed browser
- searchProducts and getProductDetail use browser-context `fetch()` to call the GraphQL endpoint (not direct node HTTP)
- getStoreLocator navigates to the store search results page and extracts DOM

## Extraction
- **searchProducts**: GraphQL `searchModel` query → adapter maps `identifiers`, `pricing`, `reviews`, `media` into flat product objects
- **getProductDetail**: GraphQL `productClientOnlyProduct` query → adapter maps product fields, `specificationGroup` → flat specs array, `taxonomy.breadCrumbs` → labels
- **getStoreLocator**: DOM extraction — store cards via `[data-testid*="store"]`, `.store-pod` selectors with fallback to link-based parsing

## Known Issues
- **searchProducts returns empty results** — GraphQL `searchModel` query returns `totalProducts: 0` in automated sessions; likely anti-bot filtering on the search endpoint. Verify passes (schema-valid empty response) but no product data is returned. getProductDetail works if you have an itemId from another source.
- **getStoreLocator DOM selectors outdated** — current selectors (`[data-testid*="store"]`, `.store-pod`) no longer match Home Depot's store finder page layout. Returns a stub "Store Finder" link instead of actual store results. Needs selector refresh.
- **GraphQL gateway requires warm session** — adapter navigates to homedepot.com homepage first and waits 3s for cookie/session initialization before API calls
- **Expected DRIFT on product data** — prices, availability, and review counts change frequently; schema validates but fingerprint hashes change
