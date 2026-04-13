# Uber Eats

## Overview
Food delivery platform. Restaurant search, menu browsing, cart operations, order history. REST + adapter on ubereats.com, cookie_session auth.

## Workflows

### Browse restaurant menu
1. `searchRestaurants(userQuery)` → restaurant list with `storeUuid`
2. `getRestaurantMenu(storeUuid)` → full menu with categories, items, prices, images

### Add simple item to cart
1. `getRestaurantMenu(storeUuid)` → find item with `hasCustomizations: false` → `itemUuid`
2. `addToCart(storeUuid, itemUuid)` → creates server-side draft order

### Add item with customizations (sauces, sides, etc.)
1. `getRestaurantMenu(storeUuid)` → find item with `hasCustomizations: true` → `itemUuid`, `sectionUuid`, `subsectionUuid`
2. `getItemDetails(storeUuid, sectionUuid, subsectionUuid, menuItemUuid)` → `customizationsList` with groups and options
3. Choose options per group: respect `minPermitted` (required count) and `maxPermitted`
4. `addToCart(storeUuid, itemUuid, customizations)` → `customizations = {groupUuid: [{uuid: optionUuid, quantity: 1}]}`

### View and manage cart
1. `getCart()` → all carts with items, prices, quantities per store
2. `removeFromCart(itemUuid)` → remove specific item from cart
3. `emptyCart(storeUuid)` → clear entire cart for a store (or all stores if omitted)

### Review past orders
1. `getEatsOrderHistory()` → orders with store, items, prices, timestamps
2. `getEatsOrderHistory(lastWorkflowUUID=nextCursor)` → next page

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchRestaurants | search restaurants by keyword | userQuery | storeUuid, name, rating, deliveryTime, deliveryFee | entry point |
| getRestaurantMenu | get full restaurant menu | storeUuid <- searchRestaurants | catalogSectionsMap with catalogItems (uuid, title, price, hasCustomizations, sectionUuid, subsectionUuid) | |
| getItemDetails | get customization options for an item | storeUuid, sectionUuid <- getRestaurantMenu, subsectionUuid <- getRestaurantMenu, menuItemUuid <- getRestaurantMenu | customizationsList with groups (uuid, title, minPermitted, maxPermitted, options) | only needed for hasCustomizations=true items |
| addToCart | add item to cart | storeUuid <- searchRestaurants, itemUuid <- getRestaurantMenu, customizations <- getItemDetails | success, cartCount | customizations optional for simple items |
| getCart | view cart contents | storeUuid (optional filter) | carts with items (uuid, title, price, quantity), totalItems | |
| removeFromCart | remove specific item from cart | itemUuid <- getRestaurantMenu | success, cartCount | removes single item, keeps others |
| emptyCart | clear entire store cart | storeUuid (optional) | success, discarded, cartCount | omit storeUuid to clear all |
| getEatsOrderHistory | list past orders | lastWorkflowUUID (pagination) | uuid, storeName, totalPrice, items, completedAt, hasMore, nextCursor | entry point; paginated |

## Quick Start

```bash
# Search Uber Eats restaurants
openweb ubereats exec searchRestaurants '{"userQuery":"pizza"}'

# Get restaurant menu
openweb ubereats exec getRestaurantMenu '{"storeUuid":"8b2f2683-50d3-4e3f-8c2e-3d00686aa3e7"}'

# Get customization options for an item
openweb ubereats exec getItemDetails '{"storeUuid":"8b2f2683-50d3-4e3f-8c2e-3d00686aa3e7","sectionUuid":"3b247595-f7a2-56c2-80c6-5e676020625a","subsectionUuid":"0379a62a-1156-4ddb-a09a-7e1dc45d5dfb","menuItemUuid":"6a7477ef-e958-5d7e-ad13-919222778971"}'

# Add simple item to cart
openweb ubereats exec addToCart '{"storeUuid":"8b2f2683-50d3-4e3f-8c2e-3d00686aa3e7","itemUuid":"66c6b385-0b1f-5a75-ada7-649e8b309fff"}'

# View cart
openweb ubereats exec getCart '{}'

# Remove item from cart
openweb ubereats exec removeFromCart '{"itemUuid":"66c6b385-0b1f-5a75-ada7-649e8b309fff"}'

# Empty entire cart
openweb ubereats exec emptyCart '{}'

# Get past orders
openweb ubereats exec getEatsOrderHistory '{}'
```

## Known Limitations
- **Store must be open**: addToCart validates store availability and fails fast if closed.
- **Items with customizations**: Items with `hasCustomizations=true` require customization selections via getItemDetails. Without it, the server may accept but reject at checkout.
- **Browser session required for cart ops**: Cart operations use page transport (Tier 5 API calls via browser context for cookie auth).
