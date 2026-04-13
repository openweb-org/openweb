# Uber

## Overview
Ride-hailing + food delivery platform. Uber Eats (ubereats.com) REST API for restaurant search, menu browsing, order history, and cart operations with cookie_session auth. Read ops use node transport; write ops use page transport via adapter.

## Workflows

### Browse restaurant menu
1. `searchRestaurants(userQuery)` → restaurant list with `storeUuid`, name, rating, delivery time
2. `getRestaurantMenu(storeUuid)` → full menu with categories, items, prices, images

### Add item to cart
1. `searchRestaurants(userQuery)` → get `storeUuid`
2. `getRestaurantMenu(storeUuid)` → get item `uuid` from `catalogSectionsMap` → `catalogItems`
3. `addToCart(storeUuid, itemUuid)` → add item to cart (browser-based, page transport)

### Remove item from cart
1. `removeFromCart(itemUuid)` → remove item from cart (browser-based, page transport)

### Review past orders
1. `getEatsOrderHistory()` → orders with store, items, prices, timestamps
2. `getEatsOrderHistory(lastWorkflowUUID=nextCursor)` → next page

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchRestaurants | search Eats restaurants by keyword | userQuery | storeUuid, name, rating, deliveryTime, deliveryFee | entry point |
| getRestaurantMenu | get full restaurant menu | storeUuid | title, sections, catalogSectionsMap with categories and catalogItems (uuid, title, price, imageUrl) | uses getStoreV1 API |
| addToCart | add item to Eats cart | storeUuid, itemUuid, quantity | success, cartCount | adapter; page transport; cart is client-side |
| removeFromCart | remove item from Eats cart | itemUuid | success, cartCount | reverse of addToCart; adapter; page transport |
| getEatsOrderHistory | list past Eats orders | lastWorkflowUUID (pagination) | uuid, storeName, totalPrice, items, completedAt, hasMore, nextCursor | entry point; paginated |

## Quick Start

```bash
# Search Uber Eats restaurants
openweb uber exec searchRestaurants '{"userQuery":"pizza"}'

# Get restaurant menu (use storeUuid from search results)
openweb uber exec getRestaurantMenu '{"storeUuid":"8b2f2683-50d3-4e3f-8c2e-3d00686aa3e7"}'

# Add item to cart (use itemUuid from menu's catalogItems)
openweb uber exec addToCart '{"storeUuid":"8b2f2683-50d3-4e3f-8c2e-3d00686aa3e7","itemUuid":"6a7477ef-e958-5d7e-ad13-919222778971"}'

# Remove item from cart
openweb uber exec removeFromCart '{"itemUuid":"6a7477ef-e958-5d7e-ad13-919222778971"}'

# Get past Eats orders (first page)
openweb uber exec getEatsOrderHistory '{}'

# Get next page of orders (use nextCursor from previous response)
openweb uber exec getEatsOrderHistory '{"lastWorkflowUUID":"<nextCursor>"}'
```
