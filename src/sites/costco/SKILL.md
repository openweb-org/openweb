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
| addToCart | add to cart | itemNumber ← searchProducts | orderItemId | write, requires login. Navigates to PDP; scrapes JWT + SKU |
| removeFromCart | remove from cart | orderItemId ← addToCart | success | write, requires login. Navigates to /CheckoutCartView |
| updateCartQuantity | change cart qty | orderItemId ← addToCart, quantity | success | write, requires login. Navigates to /CheckoutCartView |

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

# Cart workflow (requires logged-in Costco session in managed Chrome)
openweb costco exec addToCart '{"itemNumber": "100978861", "quantity": 1}'
# → returns { orderItemId: <int>, orderId, ... } — pass orderItemId to next step
openweb costco exec updateCartQuantity '{"orderItemId": "<from above>", "quantity": 2}'
openweb costco exec removeFromCart '{"orderItemId": "<from above>"}'
```

## Known Limitations

- **Cart write ops require login.** Managed Chrome must have a live Costco session (cookies copied from default Chrome). Without it, addToCart returns 403 from Akamai.
- **Cart edits are page-bound.** removeFromCart/updateCartQuantity scrape `catalogEntryId` and the WCS `authToken` from `/CheckoutCartView` hidden inputs each call — they only work for items currently in the user's cart.
- **Two distinct authToken formats.** PDP add uses a Microsoft B2C JWT (sessionStorage `authToken_<userHash>`); cart edits use a WCS `userId,signature` token (cart-page hidden input). They are not interchangeable.
