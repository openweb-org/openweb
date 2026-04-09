# Home Depot

## Overview
Home improvement retailer (archetype: e-commerce). homedepot.com — product search, details, reviews, pricing, and store availability via GraphQL federation gateway interception.

## Workflows

### Find and compare products
1. `searchProducts(keyword)` → browse results → `itemId`
2. `getProductDetail(itemId)` → full specs, price, availability

### Research product reviews
1. `searchProducts(keyword)` → `itemId`
2. `getProductReviews(itemId)` → customer reviews, ratings, photos

### Compare pricing and promotions
1. `searchProducts(keyword)` → `itemId`
2. `getProductPricing(itemId)` → sale price, original price, promotions, BOGO deals

### Check store availability before visiting
1. `searchProducts(keyword)` → `itemId`
2. `getStoreAvailability(itemId)` → pickup/delivery options, in-stock quantity, store info

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search products by keyword | keyword | itemId, name, brand, price, rating, reviewCount | entry point; navigates to /s/{keyword} |
| getProductDetail | full product info | itemId <- searchProducts | name, brand, price, description, specs, images, availability | storeId/zipCode for local pricing |
| getProductReviews | customer reviews | itemId <- searchProducts | totalReviews, reviews (rating, text, author, photos, badges) | BazaarVoice-sourced; 10 reviews per page |
| getProductPricing | detailed pricing | itemId <- searchProducts | price, originalPrice, promotions, conditionalPromotions, unitPricing | includes BOGO and clearance info |
| getStoreAvailability | store pickup/delivery | itemId <- searchProducts | fulfillmentOptions (pickup, delivery), in-stock quantity, store info | uses browser's current store context |

## Quick Start

```bash
# Search for products
openweb homedepot exec searchProducts '{"keyword": "cordless drill"}'

# Get full product details by item ID
openweb homedepot exec getProductDetail '{"itemId": "306283873"}'

# Product detail with local store pricing
openweb homedepot exec getProductDetail '{"itemId": "306283873", "zipCode": "10001"}'

# Get customer reviews
openweb homedepot exec getProductReviews '{"itemId": "306283873"}'

# Get detailed pricing info (promotions, unit pricing, clearance)
openweb homedepot exec getProductPricing '{"itemId": "306283873"}'

# Check store availability (pickup and delivery options)
openweb homedepot exec getStoreAvailability '{"itemId": "306283873"}'
```

---

## Site Internals

### API Architecture
- **GraphQL interception** — all operations use navigation-based interception of the GraphQL federation gateway (`/federation-gateway/graphql` on `apionline.homedepot.com`)
- GraphQL operations fire naturally when navigating to search/product pages; the adapter intercepts responses via `page.on('response')`
- This avoids Akamai blocking that affected the previous `page.evaluate(fetch(...))` approach

### Auth
- No auth required — all operations work on public data
- `requires_auth: false`

### Transport
- **All operations: page** — adapter runs inside managed browser
- searchProducts navigates to `/s/{keyword}` and intercepts the `searchModel` GraphQL response
- getProductDetail navigates to `/p/detail/{itemId}` and intercepts the `productClientOnlyProduct` GraphQL response
- getProductReviews navigates to `/p/detail/{itemId}` and intercepts the `reviews` GraphQL response
- getProductPricing navigates to `/p/detail/{itemId}` and intercepts the `productClientOnlyProduct` GraphQL response (pricing subset)
- getStoreAvailability navigates to `/p/detail/{itemId}` and intercepts the `productClientOnlyProduct` GraphQL response (fulfillment subset)

### Extraction
- **searchProducts**: Navigate to search page, intercept `searchModel` GraphQL response -> adapter maps `identifiers`, `pricing`, `reviews`, `media` into flat product objects
- **getProductDetail**: Navigate to product page, intercept `productClientOnlyProduct` GraphQL response -> adapter maps product fields, `specificationGroup` -> flat specs array, `taxonomy.breadCrumbs` -> labels
- **getProductReviews**: Navigate to product page, intercept `reviews` GraphQL response -> BazaarVoice-sourced reviews with ratings, text, photos, badges; returns first page (10 reviews)
- **getProductPricing**: Navigate to product page, intercept `productClientOnlyProduct` -> focused pricing view with promotions, conditionalPromotions (BOGO), unit pricing, clearance, specialBuy
- **getStoreAvailability**: Navigate to product page, intercept `productClientOnlyProduct` -> fulfillment options array with pickup (BOPIS) and delivery (express, ship-to-home) services, inventory quantities, store info

### GraphQL Operations Observed on Product Page
| GraphQL opname | Used by | Data |
|---|---|---|
| `searchModel` | searchProducts | search results |
| `productClientOnlyProduct` | getProductDetail, getProductPricing, getStoreAvailability | product, pricing, fulfillment |
| `reviews` | getProductReviews | BazaarVoice reviews |
| `mediaPriceInventory` | — (not used) | variant pricing/inventory |
| `shipping` | — (not used) | delivery timeline details |
| `aislebay` | — (not used) | store aisle/bay location |
| `promotionProducts` | — (not used) | promotion banners |

### Removed Operations
- **getStoreLocator** (removed) — URL pattern `/l/search/{zipCode}` is dead; returns an error page. DOM scraper picked up nav chrome garbage ("Store Finder") instead of store data. Requires fresh capture to re-implement.

### Known Issues
- **Expected DRIFT on product data** — prices, availability, and review counts change frequently; schema validates but fingerprint hashes change
- **Store context** — getStoreAvailability returns data for the browser's currently-selected store (based on prior navigation or geolocation). There is no way to specify a store ID in the URL; changing store requires UI interaction.
- **Review pagination** — getProductReviews returns the first page (10 reviews) only. The `reviews` GraphQL op supports pagination via page params but the adapter intercepts only the initial page load.
