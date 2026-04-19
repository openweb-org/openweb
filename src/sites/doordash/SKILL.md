# DoorDash

## Overview
Food delivery marketplace — search restaurants, browse menus, view order history, manage cart.

## Workflows

### Search and browse menu
1. `searchRestaurants(query)` → pick restaurant → `storeId`
2. `getRestaurantMenu(storeId)` → browse categories and items

### Add to cart then remove
1. `searchRestaurants(query)` → `storeId`
2. `getRestaurantMenu(storeId)` → pick item → `itemId`
3. `addToCart(storeId, itemId)` → cart confirmation → `cartId`, `orderItemId`
4. `removeFromCart(orderCartId, orderItemId)` → updated cart

### Review past orders
1. `getOrderHistory(limit)` → order list with items, totals, timestamps

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchRestaurants | search restaurants by keyword | query | name, storeId, categories, imageUrl | entry point; includes non-store results (check resultType) |
| getRestaurantMenu | get store detail + full menu | storeId ← searchRestaurants | storeHeader, menuBook, itemLists (id, name, displayPrice) | optional: menuId, fulfillmentType |
| getOrderHistory | list past orders | limit, offset | orders (store, items, grandTotal, timestamps) | paginated; requires auth |
| addToCart | add menu item to cart | storeId ← searchRestaurants, itemId ← getRestaurantMenu | success, cartId, subtotal, items | write op; optional: quantity, specialInstructions |
| removeFromCart | remove item from cart | orderCartId ← addToCart, orderItemId ← addToCart | updated cart, remaining items | write op; reverse of addToCart. Static `verify --write` cannot replay this — see Known Limitations |

## Known Limitations

- **`removeFromCart` not live-verified**: Param shape is correct (input wrapped under `removeCartItemInput`), but `verify --write` cannot pass the server-generated `cart_item_id` from `addToCart` into `removeFromCart`'s input. Agents can chain the two ops manually (call `addToCart`, read `cartId`/`orderItemId` from the response, pass into `removeFromCart`), which works end-to-end. Static replay is blocked on the cross-op response templating gap (see `doc/todo/write-verify/handoff.md` §4.1).

## Quick Start

```bash
# Search for restaurants
openweb doordash exec searchRestaurants '{"query": "pizza"}'

# Get a restaurant's menu
openweb doordash exec getRestaurantMenu '{"storeId": "245613"}'

# View recent orders
openweb doordash exec getOrderHistory '{"limit": 5}'

# Add item to cart
openweb doordash exec addToCart '{"storeId": "245613", "itemId": "12345", "quantity": 1}'

# Remove item from cart (use cartId and orderItemId from addToCart response)
openweb doordash exec removeFromCart '{"orderCartId": "cart-uuid", "orderItemId": "order-item-id"}'
```
