# Costco

## Overview
E-commerce warehouse club. Product search, detail, reviews, warehouse locator, delivery options, cart management, and product comparison.

## Workflows

### Find and evaluate a product
1. `searchProducts(query)` → product listings with `itemNumber`
2. `getProductDetail(itemNumber)` → price, description, attributes, rating
3. `getProductReviews(productId)` → review summary, rating distribution, recommendation %

### Compare products before buying
1. `searchProducts(query)` → find candidates → `itemNumber`s
2. `compareProducts(itemNumbers)` → side-by-side price, brand, rating, attributes
3. `getDeliveryOptions(itemNumber)` → shipping/pickup availability per product

### Check warehouse availability
1. `findWarehouses(latitude, longitude)` → nearby warehouses with `warehouseId`
2. `getWarehouseDetails(warehouseId)` → full hours, services, amenities
3. `checkWarehouseStock(itemNumber, warehouseNumber)` → in-store vs online-only, price

### Browse and discover
1. `searchSuggestions(query)` → autocomplete completions to refine search
2. `browseCategory(category)` → products by department with available filters

### Cart management (requires login)
1. `searchProducts(query)` → `itemNumber`
2. `addToCart(itemNumber, quantity)` → `orderItemId`
3. `updateCartQuantity(orderItemId, quantity)` → update quantity
4. `removeFromCart(orderItemId)` → remove item

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search by keyword | query | itemNumber, title, brands, pills | entry point, paginated (pageSize, offset) |
| searchSuggestions | autocomplete | query | term, type | entry point |
| getProductDetail | product details | itemNumber ← searchProducts | price, rating, attributes, buyable | price=0 means "see in cart" |
| getMultipleProducts | batch product lookup | itemNumbers ← searchProducts | price, brand, rating per item | |
| compareProducts | side-by-side comparison | itemNumbers ← searchProducts (2+) | price, brand, rating, attributes | |
| getProductReviews | review summary | productId ← searchProducts | totalReviews, averageRating, distribution | navigates page (BV widget) |
| getDeliveryOptions | shipping/pickup check | itemNumber ← searchProducts | options[].type, available, membershipRequired | types: shipping, business_delivery, warehouse_pickup |
| browseCategory | browse by department | category | products, availableFilters | entry point, paginated |
| findWarehouses | nearby warehouses | latitude, longitude | warehouseId, name, address, hours, services | entry point |
| getWarehouseDetails | full warehouse info | warehouseId ← findWarehouses | hours, services[].name/hours, has* booleans | |
| checkWarehouseStock | in-store availability | itemNumber ← searchProducts, warehouseNumber ← findWarehouses | inWarehouse, onlineOnly, price | |
| addToCart | add to cart | itemNumber ← searchProducts | orderItemId | write, requires login |
| removeFromCart | remove from cart | orderItemId ← addToCart | success | write, requires login |
| updateCartQuantity | change cart qty | orderItemId ← addToCart, quantity | success | write, requires login |

## Quick Start

```bash
# Search for products
openweb costco exec searchProducts '{"query": "laptop"}'

# Get product details (use itemNumber from search)
openweb costco exec getProductDetail '{"itemNumber": "100978861"}'

# Get review summary
openweb costco exec getProductReviews '{"productId": "4000373324"}'

# Find nearby warehouses
openweb costco exec findWarehouses '{"latitude": 37.35, "longitude": -121.95, "limit": 3}'

# Check delivery options
openweb costco exec getDeliveryOptions '{"itemNumber": "100978861", "zipCode": "95050"}'

# Browse a category
openweb costco exec browseCategory '{"category": "Electronics"}'

# Compare products side by side
openweb costco exec compareProducts '{"itemNumbers": ["100978861", "4000373324"]}'
```

---

## Site Internals

## API Architecture
- **Hybrid**: POST-based REST search + GraphQL product detail + REST warehouse locator + BazaarVoice reviews
- **Search domain**: `gdx-api.costco.com` — JSON POST body with `query`, `pageSize`, `offset`, warehouse/delivery config
- **Product domain**: `ecom-api.costco.com` — inline GraphQL query (not persisted hashes), products resolved by `itemNumbers`
- **Warehouse domain**: `ecom-api.costco.com/core/warehouse-locator/v1` — GET with lat/lng
- **Reviews**: BazaarVoice widget loads on product pages, data extracted from `BV.rating_summary.apiData` via page.evaluate
- Search returns product IDs but **no prices** — prices come from the product GraphQL
- Some products have `price: 0` meaning "see price in cart" (`disp_price_in_cart_only` attribute)

## Auth
- **No auth required** for all read operations (search, product, reviews, warehouses)
- Each API domain uses a distinct `client-identifier` (app-level, not session-level)
- **Cart operations require login** — browser must have session cookies and JWT auth token

## Transport
- **page** transport with `page.request.fetch()` — bypasses PerimeterX client-side fetch interception while inheriting browser cookies
- Must have browser on `costco.com` for the adapter to initialize
- **Reviews exception**: uses `page.goto()` + `page.evaluate` to navigate to product page and extract BV widget data from `window.BV` global

## Extraction
- Direct JSON responses for search, product, warehouse — no SSR extraction needed
- Search: `resp.searchResult.results[]` → product titles, brands, categories in nested `product.attributes` map
- Product: `resp.data.products.catalogData[]` → price, description, attributes array
- Product attributes are `{key, value, type}` arrays — adapter collapses to `Record<string, string[]>`
- `fieldData.mfName` can contain garbage ("DO NOT DELETE") — prefer `attributes.Brand` for brand name
- Rating comes as string from API — adapter converts to number
- Warehouse: `resp.salesLocations[]` → localized name/address, nested `hours[]` and `services[]` arrays
- Reviews: `window.BV.rating_summary.apiData[productId]` → summary stats from BazaarVoice internal cache

## Known Issues
- **PerimeterX**: present on `www.costco.com`, intercepts `window.fetch` and `XMLHttpRequest` in `page.evaluate`. Workaround: `page.request.fetch()`.
- **BazaarVoice auth**: BV BFD API returns 401 from `page.request.fetch()`. Reviews extracted from BV widget's cached state instead.
- **Reviews limited to summary**: full review text not available — only aggregates (count, average, distribution, recommendation %).
- **getProductReviews navigates**: uses `page.goto()` — changes current page URL, may affect subsequent operations.
- **Price $0**: some items return `price: 0` — these are "display price in cart only" items, not actually free.
- **Compiler limitation**: search and product APIs are POST with request bodies → compiler auto-skips them. Manual fixture + L3 adapter required.
