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
| removeFromCart | remove from cart | orderItemId ← addToCart | success | write, requires login. Static `verify --write` blocked on cross-op chain |
| updateCartQuantity | change cart qty | orderItemId ← addToCart, quantity | success | write, requires login. Static `verify --write` blocked on cross-op chain |

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

## Known Limitations

- **Cart write ops not live-verified** (`addToCart`, `removeFromCart`, `updateCartQuantity`): example fixtures shipped in `43471cd` so `verify --write` picks them up, but live replay still requires (a) an authenticated Costco session in the managed browser, and (b) for `removeFromCart`/`updateCartQuantity`, a server-generated `orderItemId` from a fresh `addToCart` call. Static verify cannot pass that id across ops. Agents can chain the workflow manually (`addToCart` → read `orderItemId` → `updateCartQuantity`/`removeFromCart`) and it works end-to-end. See `doc/todo/write-verify/handoff.md` §4.1.
