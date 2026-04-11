# Uber — Transport Upgrade Probe & Implementation

## Final Architecture

- **Reads**: `/_p/api/*` REST endpoints via node transport — zero browser dependency
- **Writes**: API validation + minimal DOM clicks via page transport — no server-side cart mutation API exists
- **5 operations total** (3 read + 2 write)

## Discovery Journey

### Phase 1: Initial Probe — API Architecture

Probed UberEats internals via headed browser CDP session:

**Fetch**: Native (not patched). `window.fetch.toString().length = 34`. No signing, no X-Bogus equivalent.

**Webpack**: None. No `webpackChunk`, `__LOADABLE_LOADED_CHUNKS__`, or `webpackJsonp`. UberEats uses a custom bundler.

**SSR Globals**: None. No `__NEXT_DATA__`, no Redux devtools, no `__STORE__`. UberEats is a React SPA without exposed global state.

**API Pattern**: All internal APIs use `/_p/api/{operationName}V1` pattern. POST with JSON body. Response wraps in `{ status: "success", data: {...} }`. Static CSRF token `x-csrf-token: x` (not derived from cookies).

### Phase 2: Network Capture — Discovering Cart APIs

Set up Playwright-level request interceptor and navigated to a restaurant store page. Captured 15+ API calls:

**Cart-related reads discovered:**
- `getCartsViewForEaterUuidV1` — returns `{ carts: [] }` (server-side cart sync)
- `getDraftOrdersByEaterUuidV1` — returns `{ draftOrders: [], cartsView: { shoppingCarts: [], cartsCount: 0 } }`
- `getActiveOrdersV1` — active delivery orders
- `getOrderEntitiesV1` — order entities

**Menu item API discovered:**
- `getMenuItemV1` — called when quickView modal opens. Takes `storeUuid`, `sectionUuid`, `subsectionUuid`, `menuItemUuid`. Returns full item details including customization options.

### Phase 3: Cart Mutation Probe — The Critical Finding

**Exhaustive endpoint probing**: Tested 35+ potential cart mutation endpoint names:
`addToCartV1`, `addItemToCartV1`, `createCartV1`, `updateCartV1`, `removeFromCartV1`, `deleteCartV1`, `clearCartV1`, `setDraftOrderV1`, `createDraftOrderV1`, `updateDraftOrderV1`, `deleteDraftOrderV1`, `addItemV1`, `removeItemV1`, `modifyCartV1`, `submitCartV1`, `checkoutCartV1`, `setShoppingCartV1`, `createShoppingCartV1`, `addToOrderV1`, `removeFromOrderV1`, etc.

**Result: ALL returned 404 with `ERR_MISSING_HANDLER`.** No server-side cart mutation API exists.

**Network capture during add-to-cart click**: Found an open McDonald's, navigated to quickView modal, clicked "Add 1 to order · $9.99" (`data-testid="add-to-cart-button"`). Captured ALL network requests — **zero mutation API calls fired**. Only read-only background calls (getActiveOrdersV1, getUserV1, etc.) and a consent call (setUserConsentV1).

**Conclusion: Cart is managed entirely client-side in React state.**

### Phase 4: Client-Side Cart Storage Analysis

Checked localStorage before and after adding to cart:
- `ubereats.v2.cart` — 697 bytes, contains ONLY payment preferences (selectedPayment, tip, diningMode). **NOT cart items.**
- No other keys changed in localStorage after add-to-cart click.
- `getDraftOrdersByEaterUuidV1` returned empty after add.
- `getCartsViewForEaterUuidV1` returned empty after add.

**Cart items exist only in React state (in-memory).** Not in localStorage, not in cookies, not on server. Cart state is lost when the page/context is destroyed (which happens between separate exec calls).

### Phase 5: Stable Selector Discovery

**Discovered stable data-testid selectors:**
- `data-testid="add-to-cart-button"` — "Add 1 to order" button in quickView modal
- `data-testid="quick-add-button"` — Quick add buttons on store page (multiple, one per menu item)
- `data-testid="quantity-selector-increase"` — Quantity stepper
- `data-testid="view-carts-badge"` — Cart badge with count
- `data-testid="store-loaded"` — Store page loaded indicator
- `data-testid="modality-option-DELIVERY"` / `data-testid="modality-option-PICKUP"` — Dining mode tabs

### Phase 6: Implementation — API Validation + Minimal DOM

**addToCart upgraded:**
1. `getStoreV1` API — validate store exists, resolve slug, check `isOpen`
2. Catalog parsing — find item's `sectionUuid`/`subsectionUuid`
3. `getMenuItemV1` API — validate item exists before navigation (NEW)
4. QuickView URL navigation — direct URL construction (unchanged)
5. `[data-testid="add-to-cart-button"]` click — stable selector (unchanged)
6. Cart badge verification (unchanged)

**Key improvement**: Steps 1-3 catch invalid store/item UUIDs via API before any browser navigation. Old approach navigated blindly and relied on DOM element existence to detect errors.

**removeFromCart**: Kept DOM approach — no API alternative exists. Improved error messages to document in-memory cart limitation.

## Key Patterns Discovered

- **`/_p/api/{name}V1` convention**: All UberEats APIs follow this pattern. POST with JSON. Response: `{ status: "success"|"failure", data: {...} }`.
- **`x-csrf-token: x`**: Static placeholder, not derived from cookies/page state.
- **Cart is React-only**: No server sync, no localStorage items, no cookies. State dies with the page.
- **`getMenuItemV1`**: Validates item existence and returns customization requirements. Useful as pre-flight check.
- **data-testid selectors**: UberEats uses them extensively. More stable than CSS class selectors.
- **Page sessions don't persist cart**: The runtime creates/destroys pages per exec call. Cart items from addToCart are lost before removeFromCart runs in a separate call.

## Considered but Rejected

1. **Webpack module walk** — No webpack chunks exist on UberEats. Not applicable.
2. **page.evaluate(fetch) for cart mutations** — No server-side cart API to call. All 35+ endpoint name guesses returned 404.
3. **localStorage manipulation** — `ubereats.v2.cart` doesn't contain item data. Items are in React state only.
4. **React state dispatch** — Would require finding the React fiber root and dispatching addToCart actions. Fragile (deployment-specific), and still wouldn't solve cross-session persistence.
5. **Node transport for writes** — Impossible without a server-side cart API. Reads already use node.
6. **`quick-add-button` instead of quickView** — Multiple buttons on page with no way to identify which corresponds to target item UUID. QuickView approach is more targeted.

## Pitfalls

- **Store must be open**: `addToCart` now checks `isOpen` flag via API and fails fast with clear error if store is closed. Previous approach silently navigated to a "Nothing to eat here..." page.
- **Fake example UUIDs**: The example files use non-existent UUIDs (`8b2f2683...`, `6a7477ef...`). Verify with `--write` will always fail for addToCart. Tested with real McDonald's items (Hash Browns `e4285ad5...`).
- **Cart ephemeral**: removeFromCart can only work within the same browser session where addToCart ran. Each exec call gets a fresh page context → cart is empty.
- **Items with customizations**: Meals/combos require customization options (drink, sides). The "Add to order" button may not appear or may require filling options first. Simple items (Hash Browns, condiments) work reliably.
- **Chinese locale**: The browser's UberEats shows "购物车" (cart) in Chinese based on user settings. Selectors use data-testid (locale-independent).

## Probe Evidence

### API endpoint map (captured via CDP)

| Endpoint | Type | Body | Use |
|----------|------|------|-----|
| `getStoreV1` | read | `{ storeUuid }` | Store info + full menu |
| `getSearchFeedV1` | read | `{ userQuery }` | Restaurant search |
| `getPastOrdersV1` | read | `{ lastWorkflowUUID? }` | Order history |
| `getMenuItemV1` | read | `{ storeUuid, sectionUuid, subsectionUuid, menuItemUuid }` | Item detail + customizations |
| `getCartsViewForEaterUuidV1` | read | `{}` | Server-side cart state (empty) |
| `getDraftOrdersByEaterUuidV1` | read | `{ currencyCode? }` | Draft orders (empty) |
| `getActiveOrdersV1` | read | `{ timezone }` | In-progress deliveries |
| `getUserV1` | read | `{}` | User profile |
| `getProfilesForUserV1` | read | `{}` | User profiles |
| `getBusinessProfilesV1` | read | `{}` | Business profiles |
| `getSearchHomeV2` | read | `{}` | Home feed |
| `setRobotEventsV1` | write | `{ action, payload }` | Bot detection events |
| `setUserConsentV1` | write | `{ name, value }` | Cookie consent |

### Cart mutation probe results

35+ endpoint names tested → all returned `404 ERR_MISSING_HANDLER`:
`addToCartV1`, `addItemToCartV1`, `setCartV1`, `createCartV1`, `updateCartV1`, `removeCartItemV1`, `deleteCartV1`, `clearCartV1`, `setDraftOrderV1`, `createDraftOrderV1`, `updateDraftOrderV1`, `deleteDraftOrderV1`, `modifyCartV1`, `submitCartV1`, `setShoppingCartV1`, `addToOrderV1`, `removeFromOrderV1`, etc.

## Verification

**Reads: 3/3 PASS** (searchRestaurants, getRestaurantMenu, getEatsOrderHistory) — node transport, no browser needed.

**addToCart: PASS with real data** — tested with McDonald's Hash Browns (`e4285ad5-a103-5911-880d-230c0e9f222d`), `success: true, cartCount: 1`. Fails with fake example UUIDs (expected — API validation catches it).

**removeFromCart: Limited by architecture** — cart is in-memory React state, lost between exec calls. Works within same browser session.
