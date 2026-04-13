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

# Add item to cart (use itemUuid from menu's catalogItems — pick items without required customizations)
openweb uber exec addToCart '{"storeUuid":"8b2f2683-50d3-4e3f-8c2e-3d00686aa3e7","itemUuid":"66c6b385-0b1f-5a75-ada7-649e8b309fff"}'

# Remove item from cart
openweb uber exec removeFromCart '{"itemUuid":"66c6b385-0b1f-5a75-ada7-649e8b309fff"}'

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
- **Cart**: Client-side React state for UI, but server-side draft orders (`getDraftOrdersByEaterUuidV1`) are created on add-to-cart and persist across page sessions. `getCartsViewForEaterUuidV1` returns cart summaries. No direct server-side cart mutation API — mutations require DOM interaction (add-to-cart button, remove-from-cart button on checkout).
- **Menu data**: `getStoreV1` returns the full menu via `catalogSectionsMap` → `standardItemsPayload` → `catalogItems`. Each item has `uuid`, `title`, `price` (cents), `imageUrl`, availability flags, `hasCustomizations`. `getMenuItemV1` validates individual items and returns customization details.

### Auth
- **Type**: cookie_session
- Shared session cookies across uber.com subdomains
- Auth check: look for `sid`, `csid`, or `jwt-session` cookies

### Transport
- `transport: node` — read operations use server-side HTTP with cookie_session auth
- `transport: page` — write operations (addToCart, removeFromCart) use browser adapter with API validation + minimal DOM clicks
- No browser required for read ops; cookies sourced from 4-tier cache cascade
- No server-side cart mutation API (add/remove) — but draft orders (`getDraftOrdersByEaterUuidV1`) persist server-side after DOM add-to-cart, enabling cross-page removal

### Known Issues
- **Cart mutations are DOM-only**: While cart state persists server-side via draft orders, there are no server-side APIs to add or remove items. Both operations require browser DOM interaction.
- **Items with customizations**: Meals/combos requiring customization options (drink choice, sides, sauces) may not add successfully — the "Add to order" button requires filling options first. Simple items (individual drinks, condiments) work reliably. Check `hasCustomizations` in catalog items.
- **Store must be open**: addToCart validates store availability via API and fails fast if closed.
- **removeFromCart uses checkout edit modal**: Navigates directly to `/checkout?mod=editItem&modctx=...` using draft order IDs from server API, then clicks "Remove from cart" button.
- **Ride history not available**: Only Eats operations are supported currently.
- **DataDome observed**: DataDome bot detection scripts are present on ubereats.com. The `_p/api` endpoints work reliably from node transport with session cookies.
- **addToCart reliability**: Uses stable `data-testid="add-to-cart-button"` selector via quickView URL. Item existence validated via catalog lookup during `getStoreV1` call.
- **Store UUID format**: Search results return full UUID format (e.g. `8b2f2683-50d3-4e3f-8c2e-3d00686aa3e7`). URL slugs use base64url encoding of UUID bytes.
