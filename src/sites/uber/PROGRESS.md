# Uber Fixture — Progress

## 2026-04-09: Added getRestaurantMenu + addToCart adapter

**What changed:**
- Added `getRestaurantMenu` operation via `getStoreV1` API — returns full menu with categories, items, prices, images, availability
- Added `addToCart` adapter operation — navigates to item quickView modal, clicks "Add to order" (page transport)
- Created adapter `uber-eats.ts` for browser-based cart interaction
- Updated DOC.md with menu browsing and add-to-cart workflows
- Total operations: 4 (searchRestaurants, getRestaurantMenu, addToCart, getEatsOrderHistory)

**Why:**
- Core food delivery flow was broken — users could search restaurants but couldn't see menus
- Now supports: search → browse menu → add to cart → review past orders

**Key discoveries during probe:**
- Menu data comes from `getStoreV1` API — `catalogSectionsMap` keyed by section UUID, each containing `standardItemsPayload.catalogItems` with item UUIDs, titles, prices (cents), images
- No server-side add-to-cart API exists — cart is managed client-side in localStorage (`ubereats.v2.cart`)
- DataDome bot detection scripts are present but `_p/api` endpoints work reliably from node transport
- Store UUID in URLs is base64url-encoded UUID bytes; API requires full UUID format (e.g. `8b2f2683-50d3-4e3f-8c2e-3d00686aa3e7`)
- `getMenuItemV1` API fires when clicking a menu item — takes storeUuid, sectionUuid, subsectionUuid, menuItemUuid

**Verification:** 3/3 read ops pass (`pnpm --silent dev verify uber`). addToCart is write-op (skipped by default).

## 2026-03-23: Initial discovery — Eats search, ride history, Eats orders

**What changed:**
- Discovered Uber's dual API architecture: Eats REST (`_p/api/*`) + Rides GraphQL (`riders.uber.com/graphql`)
- Built L3 adapter (`uber-api.ts`) handling both API surfaces via `page.evaluate(fetch(...))`
- Created 3 operations: `searchRestaurants`, `getRideHistory`, `getEatsOrderHistory`
- Captured API traffic via scripted Playwright CDP recording (multiple passes: initial capture, rides-focused, fare-estimate attempts)
- Added "Multi-Domain Platform" archetype to `knowledge/archetypes.md`

**Why:**
- Target intents: get ride price estimate, get ride history, search restaurants (Eats)
- Achieved 2 of 3 targets; ride price estimate blocked by non-standard React UI components on m.uber.com

**Key discoveries during capture:**
- `m.uber.com/go/graphql` and `riders.uber.com/graphql` share the same GraphQL schema but serve different page contexts
- Eats REST uses `_p/api/<operationName>` convention with POST + JSON body; CSRF is static `x-csrf-token: x`
- Ride history not on `m.uber.com/go/activity` (redirects to home); must use `riders.uber.com/trips` which calls `Activities` GraphQL query
- Eats order history uses map pattern (`ordersMap` keyed by `orderUuids` array) rather than flat array
- Fare estimation requires deep UI interaction — m.uber.com inputs have zero standard HTML attributes (no data-testid, no placeholder, no aria-label)

**Verification:** All 3 operations verified via manual Playwright script — searchRestaurants returned 71 results for "pizza", getRideHistory returned 5 past rides with fares, getEatsOrderHistory returned 10 orders with items and prices.
**Commit:** d153423
