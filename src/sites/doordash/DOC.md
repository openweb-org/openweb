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
| removeFromCart | remove item from cart | orderCartId ← addToCart, orderItemId ← addToCart | updated cart, remaining items | write op; reverse of addToCart |

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

---

## Site Internals

### API Architecture
- **GraphQL** gateway at `https://www.doordash.com/graphql/<operationName>?operation=<operationName>`
- All requests are POST with JSON body `{ operationName, variables, query }`
- Full query strings sent per-request (no persisted query hashes)
- Responses can be large: storepageFeed ~230KB, getConsumerOrdersWithDetails ~86KB
- Compiler cannot auto-compile (all POST with body → auto-skipped) — requires manual L3 adapter

### Auth
- **cookie_session** — user must be logged in via managed browser
- Auth cookies: `dd_session_id`, `ddweb_token`
- No CSRF header injection needed (reads and writes work with cookies only)

### Transport
- **page** (L3 adapter) — `page.evaluate(fetch(..., { credentials: 'include' }))` leverages browser cookies
- Any DoorDash page must be open (`doordash.com/*`)

### Extraction
- Direct JSON from GraphQL responses
- Search adapter normalizes nested `FacetV2` structure, parses `custom` JSON for `store_id`
- Menu and order data returned as-is from GraphQL

### Known Issues
- `formattedAddress` in order history is often null
- Search results include non-store items (grocery suggestions) — use `resultType` to filter
- No bot detection observed for authenticated sessions
- removeFromCart requires `orderCartId` and `orderItemId` from a prior addToCart response — these are ephemeral cart identifiers
