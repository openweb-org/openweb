# Amazon — Transport Upgrade

## Final Architecture

- **Transport**: `page` (Akamai Bot Manager blocks all Node.js requests)
- **Reads**: DOM extraction from SSR HTML pages (no JSON APIs available)
- **Writes**: Patchright native `.click()` for cart mutations (Amazon's JS handles AJAX)
- **Cart state**: JSON API `/cart/add-to-cart/get-cart-items` for reliable cart data
- **8 operations total** (5 read + 3 write/cart)

## Stability Ladder Position

```
脆弱 ←——————————————→ 稳定

DOM操作序列       ← removeFromCart (was: page.evaluate .click())
  ↓
DOM解析提取       ← searchProducts, getProductDetail, getProductReviews, getBestSellers (unchanged)
  ↓
API intercept
  ↓
page.evaluate     ← getCart (upgraded: JSON API + DOM enrichment)
  (fetch)           ← searchDeals (unchanged: /d2b/api/v1/products/search)
                    ← addToCart/removeFromCart response verification (upgraded: JSON API)
  ↓
node直连          ✗ Blocked by Akamai Bot Manager
```

## Discovery Journey

### Phase 1: Probe — Understanding Amazon's Internals

Probed Amazon via CDP on headed Chrome, running 8+ probe scripts:

**Probe 1: Fetch inspection.**
- `window.fetch.toString().length` = 34 — **native, NOT patched**. No auto-signing like TikTok.
- No monkey-patching layer at all. Amazon's frontend is traditional SSR HTML.

**Probe 2: Webpack discovery.**
- No main-app webpack. Only `webpackChunk_amzn_rufus_panel_web_assets` (the Rufus AI chat widget, not the main site).
- Amazon uses its own `P` framework (not React/Vue/Angular). No standard SPA architecture.

**Probe 3: Global state variables.**
- No `__NEXT_DATA__`, `__INITIAL_STATE__`, `__APP_STATE__`, or any SSR hydration globals.
- Amazon's JS framework uses `ue` (User Experience telemetry) and `P` (Promise/module loader).

**Probe 4: JSON-LD.**
- No `<script type="application/ld+json">` on product detail pages. Despite DOC.md claiming JSON-LD extraction, it doesn't exist in practice.

**Probe 5: Network sniffing.**
- XHR/fetch during page loads: mostly telemetry (unagi, fls-na), ad tracking, and Rufus AI.
- **Key discovery**: `/cart/add-to-cart/get-cart-items?clientName=SiteWideActionExecutor` returns **clean JSON** array of cart items.
- No JSON APIs for search, product detail, reviews, or best sellers.

**Probe 6: Cart mutation API.**
- Add-to-cart button click triggers POST to `/cart/add-to-cart/ref=dp_start-bbf_1_glance` with 7 params (CSRF token, ASIN, offerListingId, price, clientName).
- Delete button click triggers POST to `/cart/ref=ox_sc_cart_actions_1` with JSON `actionPayload: [{type: "DELETE_START", payload: {itemId: uuid}}]`.
- Both return JSON responses.

**Probe 7: Akamai protection.**
- `page.evaluate(fetch(...))` to cart mutation endpoints → **403 Forbidden** every time.
- Both `fetch()` and `XMLHttpRequest` from page context are blocked.
- Patchright native `.click()` works because it triggers Amazon's own JS which has valid Akamai session tokens.
- **Conclusion**: Cart mutation APIs exist but are Akamai-protected from programmatic fetch calls, even within the browser context.

**Probe 8: Internal API probes.**
- `/gp/aod/ajax`, `/gp/product/ajax`, `/api/2017/suggestions` — all 404.
- Amazon's product data is exclusively in server-rendered HTML. No JSON APIs for reads.

### Phase 2: Architecture Decision

Considered approaches and why they were rejected:

1. **Node transport** — Rejected: Akamai blocks all requests without valid `_abck` cookies and browser fingerprint.
2. **page.evaluate(fetch) for cart writes** — Rejected: Returns 403. Akamai protects cart mutation endpoints from programmatic access.
3. **Webpack module walk** — Rejected: Amazon doesn't use webpack for its main app (only Rufus AI widget).
4. **jQuery AJAX** — Rejected: jQuery is not loaded on cart pages.
5. **SSR global extraction** — Rejected: No SSR hydration globals exist.

**Decision:**
- **getCart**: Hybrid — JSON API (`/cart/add-to-cart/get-cart-items`) for reliable item list + DOM for enrichment (title, price, image). This is the biggest upgrade — cart item list now comes from a structured API instead of fragile DOM parsing.
- **addToCart**: Keep patchright `.click()` for the add action, but verify result via JSON API instead of parsing confirmation DOM selectors.
- **removeFromCart**: Switch from `page.evaluate(() => deleteBtn.click())` to patchright native `.click()` (triggers Amazon's JS event handlers properly), verify result via JSON API.
- **Read ops**: Keep DOM extraction (no alternative). Use `data-*` attributes where available (more stable than class selectors).

### Phase 3: Implementation

**getCart rewrite** — biggest improvement:
- Before: Pure DOM extraction from `[data-asin][data-itemtype="active"]` elements, parsing class-name-based selectors for title/price/image.
- After: Calls `/cart/add-to-cart/get-cart-items` for definitive item list (asin, quantity, merchantId), then enriches with DOM data attributes (`data-price`) and stable selectors for title/image.
- Benefits: Item list is now API-driven (won't miss items hidden by DOM virtualization), quantity comes from API (not fragile selector), price from `data-price` attribute (more stable than `.sc-product-price` class).

**addToCart improvement:**
- Before: Parse confirmation from fragile side-panel DOM selectors (`#NATC_SMART_WAGON_CONF_MSG_SUCCESS`, `#huc-v2-order-row-confirm-text`, etc.).
- After: Snapshot cart before add, click button, then verify via JSON API (compare quantities). Zero dependency on confirmation UI selectors.

**removeFromCart improvement:**
- Before: `page.evaluate(async (asin) => { deleteBtn.click() })` — DOM click from evaluate context.
- After: Extract delete button name from DOM, then use patchright's native `.click()` on the locator. Verify removal via JSON API.
- Patchright's `.click()` generates real mouse events that trigger Amazon's JS event handlers, which initiate the proper AJAX delete flow.

## Key Patterns Discovered

- **Amazon is NOT an SPA**: Traditional server-side rendered HTML with `P` framework for module loading. No React, no webpack, no hydration globals.
- **Akamai blocks page.evaluate(fetch)**: Cart mutation APIs exist and return JSON, but Akamai's bot detection blocks programmatic fetch/XHR even from within the browser context. Only clicks through Amazon's own JS work.
- **`/cart/add-to-cart/get-cart-items`**: Clean JSON API that returns cart contents without Akamai blocking. Works from `page.evaluate(fetch)`.
- **Cart data attributes**: Cart items have `data-price`, `data-quantity`, `data-itemid` attributes — more stable than class-name selectors.
- **Cart mutation via button click**: Add-to-cart POST goes to `/cart/add-to-cart/ref=...` with 7 params. Delete POST goes to `/cart/ref=ox_sc_cart_actions_1` with JSON `actionPayload`. Both triggered by Amazon's JS on button click.
- **No JSON-LD on product pages**: Despite DOC.md claiming `script_json` extraction, Amazon doesn't embed Schema.org JSON-LD.

## Pitfalls

- `page.evaluate(fetch('/cart/...'))` → 403 for any cart mutation endpoint. Must use patchright `.click()`.
- Cart delete button name format: `submit.delete-active.{uuid}` — UUID is per-item, not per-ASIN. Must map ASIN→UUID via DOM.
- `addToCart` form has 50+ hidden fields but actual AJAX only sends 7 — Amazon's JS filters before sending.
- `getCart` JSON API doesn't return title/price/image — need DOM enrichment for rich data.
- Product pages may not have `#addToCart` form if out of stock or ASIN is invalid.
- Amazon's `P` framework lazy-loads modules — global objects may not be available immediately after navigation.

## What Was NOT Upgraded (and Why)

- **searchProducts, getProductDetail, getProductReviews, getBestSellers**: No JSON APIs exist. Amazon serves product data exclusively as SSR HTML. These must stay as DOM extraction.
- **searchDeals**: Already uses `page.evaluate(fetch('/d2b/api/v1/products/search'))` — already at the optimal level.
- **Node transport**: Akamai blocks all non-browser requests. Cannot be bypassed.

## Verification

**Result: 8/8 PASS** (2026-04-11)

5 read ops + 3 write ops, all passing with `verify amazon --browser --write`.
