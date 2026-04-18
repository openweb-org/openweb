# Uber Fixture — Progress

## 2026-04-18: Re-route getEatsOrderHistory through adapter (forward-fix from 294e9df) — getCart + getEatsOrderHistory verify still BLOCKED

**Context:** `pnpm dev verify ubereats` reproducibly fails 2/5 ops:
- `getCart: FAIL — getDraftOrdersByEaterUuidV1: status code error`
- `getEatsOrderHistory: FAIL — expected status=200 schema=true; got status=200 schema=false`

294e9df dropped the adapter routing for `getEatsOrderHistory` claiming declarative `transport: page` would work via `page.evaluate(fetch(...))`. Reading the code, declarative `transport: page` actually routes through `browser-fetch-executor.ts` which executes the fetch from an `about:blank` iframe — that yields `Origin: null` (per HTML spec, opaque origin) and Uber's `_p/api/getPastOrdersV1` rejects with the bare error envelope `{"message":"","code":3,"meta":{}}` instead of the success envelope `{status:"success", data:{...}}`. The 294e9df commit's "5/5 PASS" claim couldn't be reproduced today; the shape of the runtime path means it was likely never green stably.

**Changes:**
- Restored `getEatsOrderHistory` adapter handler in `adapters/uber-eats.ts` (revert of 294e9df, equivalent to b7f8e82). Adapter routes through `pageFetch` (page-context `fetch` with proper `Origin`) which is what `getCart` and other cart ops already use.
- Re-added `x-openweb.adapter` ref on `getPastOrdersV1` while keeping `transport: page` so the adapter executor takes the path. Removed the now-redundant `unwrap: data` (adapter returns the unwrapped shape directly).
- Synced `openapi.yaml` and built adapter to `~/.openweb/sites/ubereats/`.

**Verify result (2 consecutive runs, deterministic):** 3/5 PASS. searchRestaurants + getRestaurantMenu + getItemDetails (all `transport: node`, public endpoints) PASS. The two cart/history ops still fail with backend-level error envelopes:
- `getDraftOrdersByEaterUuidV1` returns `{status:"failure", data:{message:"status code error"}}` even with `pageFetch` from a warmed page (whether at `/`, `/cart`, `/orders`, or `/feed`).
- `getPastOrdersV1` returns `{message:"", code:3, meta:{}}` from the same path.

**Blocker — upstream auth/eater context, not OpenWeb code:**
Both failing endpoints are user-scoped (`getDraftOrdersByEaterUuidV1`, `getPastOrdersV1`). The passing endpoints (`getSearchFeedV1`, `getStoreV1`, `getMenuItemV1`) are public. The error shapes (`code:3` enum + Uber's "status code error" string) are application-layer rejections from Uber, not 401/403 HTTP. Most likely the browser session at `ubereats.com` has lost user/eater identity (cookie expiry, region/delivery-address invalidation, or a cookie scope shift) — the public endpoints work because they don't read the eater UUID. None of the in-spec mitigations (`page_plan.entry_url` to `/`, `/cart`, `/orders`, `/feed`; warm-on-page) move the result.

**Next step (out of this fix's scope):**
- Manually open the browser (`openweb browser start --no-headless`), navigate to `ubereats.com/orders`, confirm the orders list renders for the logged-in user, and refresh delivery address if prompted. If the orders page itself shows "sign in" or "set address", the session needs re-auth or address re-selection — not a code fix.
- If after a manual session refresh `getPastOrdersV1` from devtools still returns `{message:"", code:3}`, investigate Uber-side changes (new required header such as `x-uber-client-name` / locale cookie).

**Files touched this session:**
- `src/sites/ubereats/openapi.yaml` — `getPastOrdersV1` re-routed through `uber-eats` adapter (`transport: page` retained, `unwrap: data` removed).
- `src/sites/ubereats/adapters/uber-eats.ts` — restored `getEatsOrderHistory` handler + OPERATIONS map entry.

## 2026-04-13: Transport upgrade — Tier 1 (DOM clicks) → Tier 5 (page.evaluate API)

**Context:** After fixing removeFromCart with DOM-based checkout edit modal approach, CDP network interception revealed the actual mutation APIs: `createDraftOrderV2` (add) and `discardDraftOrdersV1` (remove). Both work via `page.evaluate(fetch)`.

**Changes:**
- Rewrote both `addToCart` and `removeFromCart` to pure API calls — zero DOM selectors
- `addToCart`: validates store/item via `getStoreV1`, calls `createDraftOrderV2` with item details + customizations
- `removeFromCart`: finds item via `getDraftOrdersByEaterUuidV1`, calls `discardDraftOrdersV1`
- Added `customizations` parameter to addToCart for items with required options (sauces, sides)
- Customization format: `{groupUuid: [{uuid: optionUuid, quantity: 1}]}` — get groups/options from `getMenuItemV1`

**Discovery path:** Earlier probing (35+ endpoints) missed these APIs because:
1. `createDraftOrderV2` was probed as V1 (V1 returns 404, V2 exists)
2. `discardDraftOrdersV1` was never guessed (probed removeFromCartV1, deleteCartItemV1, etc.)
3. CDP-level network interception of the actual DOM button clicks revealed the real endpoint names

**Verification:** 5/5 ops pass (`pnpm dev verify uber --browser --write`). Stable across multiple runs.

## 2026-04-13: Fix removeFromCart — server-side draft orders + checkout edit modal

**Context:** removeFromCart was failing with selector timeout. The previous implementation tried guessed selectors (`cart-item-delete-button`, `delete-button`, etc.) on the checkout page, none of which exist.

**Key discovery:** UberEats cart IS server-side via draft orders. `getDraftOrdersByEaterUuidV1` returns cart items with `shoppingCartItemUuid` and `draftOrderUUID` after DOM add-to-cart. This corrects the earlier probe finding that "no server-side cart API exists" — the draft order read APIs were returning empty because no items had been added during probing.

**Changes:**
- Rewrote `removeFromCart` adapter: calls `getDraftOrdersByEaterUuidV1` to find item, navigates directly to `/checkout?mod=editItem&modctx=...` using draft order IDs, clicks "Remove from cart" button with retry loop
- Switched test fixture to DASANI Bottled Water (`66c6b385-0b1f-5a75-ada7-649e8b309fff`) — simple item with no required customizations. The previous McNuggets item now requires sauce selection, causing addToCart to silently fail.
- Updated DOC.md: corrected cart architecture (server-side via draft orders, not in-memory only)

**Transport investigation:** All 10 probed cart mutation endpoints (addToCartV1, removeFromCartV1, etc.) return 404 "Missing RPC handler". No transport upgrade possible for cart mutations — DOM interaction remains the only path (Tier 1). However, removeFromCart now uses server-side draft order API for item discovery (Tier 5 hybrid).

**Verification:** 5/5 ops pass (`pnpm dev verify uber --browser --write`). Stable across 2 consecutive runs.

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

## 2026-04-13 — Fix: addToCart optimization — remove redundant API call and waits

**Context:** addToCart was timing out due to a redundant `getMenuItemV1` API validation call and overly conservative wait times. The item is already validated by catalog lookup in step 2.
**Changes:** Removed `getMenuItemV1` call (catalog lookup already confirms item existence). Reduced `ensureUberEatsPage` timeout from 30s to 15s and wait from 3s to 1.5s. Removed post-navigation 4s wait (replaced by `waitFor` on add button). Reduced post-click wait from 3s to 1.5s.
**Verification:** `pnpm build` passes. addToCart completes within timeout budget.

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
