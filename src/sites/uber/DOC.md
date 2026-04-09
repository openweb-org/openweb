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

### Review past orders
1. `getEatsOrderHistory()` → orders with store, items, prices, timestamps
2. `getEatsOrderHistory(lastWorkflowUUID=nextCursor)` → next page

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchRestaurants | search Eats restaurants by keyword | userQuery | storeUuid, name, rating, deliveryTime, deliveryFee | entry point |
| getRestaurantMenu | get full restaurant menu | storeUuid | title, sections, catalogSectionsMap with categories and catalogItems (uuid, title, price, imageUrl) | uses getStoreV1 API |
| addToCart | add item to Eats cart | storeUuid, itemUuid, quantity | success, cartCount | adapter; page transport; cart is client-side |
| getEatsOrderHistory | list past Eats orders | lastWorkflowUUID (pagination) | uuid, storeName, totalPrice, items, completedAt, hasMore, nextCursor | entry point; paginated |

## Quick Start

```bash
# Search Uber Eats restaurants
openweb uber exec searchRestaurants '{"userQuery":"pizza"}'

# Get restaurant menu (use storeUuid from search results)
openweb uber exec getRestaurantMenu '{"storeUuid":"8b2f2683-50d3-4e3f-8c2e-3d00686aa3e7"}'

# Add item to cart (use itemUuid from menu's catalogItems)
openweb uber exec addToCart '{"storeUuid":"8b2f2683-50d3-4e3f-8c2e-3d00686aa3e7","itemUuid":"6a7477ef-e958-5d7e-ad13-919222778971"}'

# Get past Eats orders (first page)
openweb uber exec getEatsOrderHistory '{}'

# Get next page of orders (use nextCursor from previous response)
openweb uber exec getEatsOrderHistory '{"lastWorkflowUUID":"<nextCursor>"}'
```

---

## Site Internals

### API Architecture
- **Eats**: REST-style POST endpoints at `ubereats.com/_p/api/<operationName>`. Request body is JSON. Response wraps data in `{ status, data }`.
- Both APIs accept `x-csrf-token: x` (static placeholder, not derived from cookies).
- **Menu data**: `getStoreV1` returns the full menu via `catalogSectionsMap` → `standardItemsPayload` → `catalogItems`. Each item has `uuid`, `title`, `price` (cents), `imageUrl`, availability flags.
- **Cart**: Client-side only (localStorage `ubereats.v2.cart`). No server API for add-to-cart — the adapter navigates to the item quickView modal and clicks "Add to order".

### Auth
- **Type**: cookie_session
- Shared session cookies across uber.com subdomains
- Auth check: look for `sid`, `csid`, or `jwt-session` cookies

### Transport
- `transport: node` — read operations use server-side HTTP with cookie_session auth
- `transport: page` — addToCart uses browser adapter (cart is client-side)
- No browser required for read ops; cookies sourced from 4-tier cache cascade

### Known Issues
- **Ride history not available**: The `getRideHistory` operation was in the original capture plan but is not implemented in the adapter — only Eats operations are supported currently.
- **Ride price estimate not captured**: The fare estimation GraphQL operation requires entering pickup + dropoff addresses via the m.uber.com SPA with custom React components (no standard attributes), making automated interaction difficult.
- **Eats search redirect**: Navigating to `ubereats.com/search?q=X` redirects through a `?next=` parameter. The `getSearchFeedV1` API call bypasses this.
- **DataDome observed**: DataDome bot detection scripts are present on ubereats.com. Direct `page.evaluate(fetch)` may be intermittently blocked. The `_p/api` endpoints work reliably from node transport with session cookies.
- **addToCart reliability**: The add-to-cart button click may not trigger reliably via programmatic interaction due to React event handling. The adapter makes a best-effort attempt.
- **Store UUID format**: Search results return full UUID format (e.g. `8b2f2683-50d3-4e3f-8c2e-3d00686aa3e7`). URL slugs use base64url encoding of UUID bytes.
