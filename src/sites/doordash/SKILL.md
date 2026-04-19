# DoorDash

## Overview
Food delivery marketplace — search restaurants, browse menus, view order history, manage cart.

## Workflows

### Search and browse menu
1. `searchRestaurants(query)` → pick restaurant → `storeId`
2. `getRestaurantMenu(storeId)` → browse categories → pick item → `itemId`, `name`, `displayPrice`, `menuBook.id`

### Add to cart, then remove
1. `searchRestaurants(query)` → `storeId`
2. `getRestaurantMenu(storeId)` → pick item → `itemId`, `name` (→ `itemName`), `displayPrice` (→ `unitPrice` in cents), `menuBook.id` (→ `menuId`)
3. `addToCart(storeId, itemId, itemName, currency='USD', unitPrice, menuId, quantity)` → `addCartItemV2.id` (→ `cartId`), `addCartItemV2.orders[0].orderItems[0].id` (→ `itemId` for remove)
4. `removeFromCart(cartId, itemId)` → updated cart (subtotal/orders are `null` when cart becomes empty)

### Review past orders
1. `getOrderHistory(limit)` → order list with items, totals, timestamps

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchRestaurants | search restaurants by keyword | query | name, storeId, categories, imageUrl | entry point; includes non-store results (check resultType) |
| getRestaurantMenu | get store detail + full menu | storeId ← searchRestaurants | storeHeader, menuBook (id → menuId), itemLists (id, name, displayPrice) | optional: menuId, fulfillmentType |
| getOrderHistory | list past orders | limit, offset | orders (store, items, grandTotal, timestamps) | paginated; requires auth |
| addToCart | add menu item to cart | storeId ← searchRestaurants; itemId, itemName, unitPrice (cents), menuId ← getRestaurantMenu; currency='USD' | addCartItemV2.id (cartId), addCartItemV2.orders[0].orderItems[0].id | write op; all six input fields are server-required |
| removeFromCart | remove item from cart | cartId, itemId ← addToCart | removeCartItemV2 (subtotal/orders null if cart now empty) | write op; mutation takes `cartId`/`itemId` directly — no `RemoveCartItemInput` wrapper |

## Quick Start

```bash
# Search for restaurants
openweb doordash exec searchRestaurants '{"query": "pizza"}'

# Get a restaurant's menu (returns itemId, name, displayPrice, menuBook.id)
openweb doordash exec getRestaurantMenu '{"storeId": "245613"}'

# View recent orders
openweb doordash exec getOrderHistory '{"limit": 5}'

# Add item to cart — all six fields required by upstream
openweb doordash exec addToCart '{"addCartItemInput": {"storeId": "245613", "itemId": "23864478062", "itemName": "12 Inch Plain Cheese Pizza", "currency": "USD", "unitPrice": 1440, "menuId": "57979746", "quantity": 1}}'

# Remove item from cart (cartId + itemId from addToCart response)
openweb doordash exec removeFromCart '{"cartId": "<addCartItemV2.id>", "itemId": "<addCartItemV2.orders[0].orderItems[0].id>"}'
```

## Known Limitations

- `addCartItemInput` requires six fields (storeId, itemId, itemName, currency, unitPrice in cents, menuId) — partial input returns `BAD_USER_INPUT`. All values come from `getRestaurantMenu`; `currency` is `"USD"` for US accounts.
- `removeFromCart` returns nulls for subtotal/currencyCode/fulfillmentType/restaurant/orders when the removed item was the last one in the cart (cart UUID still returned).
- `formattedAddress` in order history is often null.
- Search results include non-store items (grocery suggestions) — filter via `resultType`.
