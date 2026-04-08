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
| searchProducts | search products by keyword | keyword | itemId, name, brand, price, rating, reviewCount | entry point; navigates to /s/{keyword} |
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
- **Hybrid** — searchProducts and getProductDetail use navigation-based interception of the GraphQL federation gateway (`/federation-gateway/graphql`); getStoreLocator uses page-level DOM extraction
- GraphQL operations fire naturally when navigating to search/product pages; the adapter intercepts responses via `page.waitForResponse()`
- This avoids Akamai blocking that affected the previous `page.evaluate(fetch(...))` approach

## Auth
- No auth required — all operations work on public data
- `requires_auth: false`

## Transport
- **All operations: page** — adapter runs inside managed browser
- searchProducts navigates to `/s/{keyword}` and intercepts the `searchModel` GraphQL response
- getProductDetail navigates to `/p/detail/{itemId}` and intercepts the `productClientOnlyProduct` GraphQL response
- getStoreLocator navigates to the store search results page and extracts DOM

## Extraction
- **searchProducts**: Navigate to search page, intercept `searchModel` GraphQL response → adapter maps `identifiers`, `pricing`, `reviews`, `media` into flat product objects
- **getProductDetail**: Navigate to product page, intercept `productClientOnlyProduct` GraphQL response → adapter maps product fields, `specificationGroup` → flat specs array, `taxonomy.breadCrumbs` → labels
- **getStoreLocator**: DOM extraction — store cards via `[data-testid*="store"]`, `.store-pod` selectors with fallback to link-based parsing

## Known Issues
- **getStoreLocator DOM selectors outdated** — current selectors (`[data-testid*="store"]`, `.store-pod`) no longer match Home Depot's store finder page layout. Returns a stub "Store Finder" link instead of actual store results. Needs selector refresh.
- **Expected DRIFT on product data** — prices, availability, and review counts change frequently; schema validates but fingerprint hashes change
