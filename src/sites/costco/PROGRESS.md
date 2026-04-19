# Costco Fixture — Progress

## 2026-03-23: Initial discovery and fixture creation

**What changed:**
- Discovered Costco's API architecture: POST-based search API on `gdx-api.costco.com` + GraphQL product API on `ecom-api.costco.com`
- Created L3 adapter (`costco-api.ts`) with two operations: `searchProducts`, `getProductDetail`
- Overcame PerimeterX blocking `page.evaluate(fetch(...))` — switched to `page.request.fetch()`
- Identified required custom headers: `client-identifier`, `costco.env`, `costco.service`
- Fixed search 500 error by adding `visitorId` and `userInfo` to request body
- Fixed product 404 by adding `costco.env: ecom` and `costco.service: restProduct` headers
- Fixed brand extraction (prefer `attributes.Brand` over `fieldData.mfName` which can be garbage)
- Fixed rating type (string from API → number in adapter)
- Updated knowledge files: `archetypes.md` (e-commerce PerimeterX patterns), `auth-patterns.md` (Costco not blocked)

**Why:**
- M26 discovery task: add Costco product search and detail coverage
- Costco is a major e-commerce site with unique POST-based API + PerimeterX combination

**Verification:** API-level PASS (both operations). Content-level verified: search results match visible products on costco.com (titles, brands, promotions). Product detail returns correct prices ($499.99 Acer laptop), ratings (3.9/5, 219 ratings), full HTML descriptions, and attributes. Build passes.
**Commit:** d8dc743 (initial), 31d2f6b (PerimeterX bypass + verification fixes)

## 2026-03-26: Expand coverage from 2 to 5 operations

**What changed:**
- Added `getProductReviews`: extracts review summary (count, average, distribution, recommendation %) from BazaarVoice widget's internal state via `page.evaluate`
- Added `findWarehouses`: warehouse locator API returning address, hours, services, distance — discovered separate `client-identifier` (`7c71124c-...`)
- Added `addToCart` (write): POST-based cart API requiring login session, gated with `write` permission
- Added test fixtures for getProductReviews and findWarehouses
- Updated DOC.md with all 5 operations, expanded API architecture and known issues

**Why:**
- Expand Costco coverage to match e-commerce archetype (search, detail, reviews, store info, cart)

**Key findings:**
- BazaarVoice BFD API (`apps.bazaarvoice.com/bfd/...`) returns 401 from `page.request.fetch()` — requires internal auth added by BV's `bvFetch` wrapper. Workaround: extract from `window.BV.rating_summary.apiData` after navigating to product page
- Warehouse locator uses a different `client-identifier` than search/product APIs
- PerimeterX blocks ALL network requests from page context (fetch, XHR) including to third-party domains like bazaarvoice.com

**Verification:** API-level PASS (4 read ops: searchProducts, getProductDetail, getProductReviews, findWarehouses). addToCart unverified (write, requires auth). Build passes.

## 2026-04-13 — Schema Fix

**Context:** browseCategory filter objects sometimes omit fields depending on category type.
**Changes:** openapi.yaml — removed required on browseCategory filters response schema.
**Verification:** Verify pass; schema accepts the variable filter shapes returned by the API.

## 2026-04-19 — Write-op verify investigation

**Context:** First end-to-end `verify --write` sweep across the site catalog. `addToCart`, `removeFromCart`, `updateCartQuantity` reported `0/0 ops setup-fail` — the `--ops` filter matched nothing because there were no example fixture files to load. Initial hypothesis was an `a61232b` CustomRunner-migration regression; investigation showed the examples were simply never shipped.
**Changes:** `43471cd` adds three `examples/*.example.json` fixtures (addToCart, removeFromCart, updateCartQuantity), each tagged `replay_safety: "unsafe_mutation"` so they only run under `--write`. DOC.md Known Issues + SKILL.md Known Limitations updated to record the two stacked blockers (missing fixtures + cross-op chain).
**Verification:** 0/3 partial — fixture loading gate now passes; live replay still blocked on (a) authenticated Costco session in the managed browser, and (b) cross-op chain for `removeFromCart`/`updateCartQuantity`. The CustomRunner adapter (post-`a61232b`) is correct; ops are gated by site auth + the architectural cross-op gap, not by an adapter regression.
**Key discovery:** The `0/0 ops setup-fail` pattern is a real footgun. Before this campaign, `verify --all` skipped writes by default, so missing example.json files went unnoticed for months. **Future agents:** when a write op reports `0/0 ops`, list `src/sites/<site>/examples/` first — the fixture is probably just absent. Same cross-op chain limitation applies as for doordash/target — see `doc/todo/write-verify/handoff.md` §4.1.

## 2026-04-19 — Cart write ops 3/3 PASS (root cause: APIRequestContext, not cookies)

**Context:** After `43471cd` shipped fixtures, the next session ran `verify --write` and saw addToCart hang for 45s (op timeout) → tier-4 login cascade → still timed out. Initial hypothesis was that cookies/session weren't transferring from default Chrome → managed Chrome (instagram had a similar-sounding symptom). Direct CDP probes refuted that: 41 costco.com cookies were present in the managed browser, including `WC_AUTHENTICATION_<userId>`, `JSESSIONID`, `mSign=1`, `WC_SESSION_ESTABLISHED=true`. Login state was intact.

**Changes:**
- Rewrote cart adapter (`src/sites/costco/adapters/costco-api.ts`):
  - Removed `cartRequest` (was `page.request.fetch()` — Akamai 403)
  - Three new functions using `page.evaluate(fetch())` from DOM context
  - `addToCart`: navigates PDP, scrapes JWT from `sessionStorage["authToken_<userHash>"]` and SKU from JSON-LD `Product.sku`, POSTs full WCS param set to `/AjaxManageShoppingCartCmd`
  - `removeFromCart`: scrapes WCS authToken + `orderId` + `catalogEntryId_N` from `/CheckoutCartView` hidden inputs (matched to `orderItem_N=<orderItemId>`), POSTs to `/AjaxModularManageShoppingCartCmd?checkoutPage=cart`
  - `updateCartQuantity`: same scrape, POSTs to `/order-quantity-update?checkoutPage=cart`
- `openapi.yaml`:
  - Added `page_plan.entry_url` for each cart op (PDP for add, `/CheckoutCartView` for edit) — runtime pre-navigates so adapter can skip redundant `page.goto`
  - addToCart response schema: replaced `{ success, orderItemId: string|null }` with the actual upstream shape (`orderItemId: integer`, `orderId`, `addedItem`, `productBeanId`, `storeId`, `catalogId`)
  - `orderItemId` param schema for remove/update: `type: [string, integer]` so cross-op templating accepts the integer addToCart returns
- Examples chain via `${prev.addToCart.orderItemId}` (cross-op templating landed in a sibling worker's `91890bc`)
- DOC.md / SKILL.md updated with the two authToken formats, the catalogEntryId scrape requirement, and the page-bound nature of cart edits

**Verification:** `pnpm dev verify costco --write --browser --ops addToCart,updateCartQuantity,removeFromCart` → ✓ 3/3 PASS. `pnpm dev costco exec` confirmed each op individually returns 200 with valid response payload (`orderItemId`, success markers, etc.). Lint clean.

**Key discovery:** Costco's Akamai Bot Manager fingerprints Playwright's `APIRequestContext` (`page.request.fetch()`) and returns 403 even with valid session cookies AND post-warm `_abck`/`bm_sz` sensor cookies. The same request from `page.evaluate(fetch())` (DOM context, runs inside the JS engine that solved the Akamai sensor challenge) returns 200. **The original adapter comment claimed "PerimeterX intercepts window.fetch ... so we use page.request which bypasses it" — that was wrong twice over: the protector is Akamai, not PerimeterX, and DOM fetch works while APIRequestContext is what gets blocked.** This pattern likely applies to other Akamai-protected e-commerce sites (Macy's, Best Buy variants, etc.) — write paths should default to DOM fetch.

**Pitfalls encountered:**
- **Site-package shadowing:** `src/sites/costco` edits had no effect because `~/.openweb/sites/costco/` and `dist/sites/costco/` (built older copies) take precedence in `resolveSiteRoot()`. Symptom: stderr debug writes never appeared, "Waiting for login" came from somewhere unexpected. Fix during dev: temporarily move both shadowing copies aside, or run `pnpm build`. After landing, restore both so production resolution still works.
- **Two distinct authToken formats** (B2C JWT vs WCS `userId,signature`) — easy to confuse. JWT goes to PDP-add; WCS token goes to cart-edit endpoints. They are not interchangeable; the wrong one yields `CMN4502E missing argument`.
- **Real SKU ≠ URL itemNumber.** PDP URL says `100978861` (parent catalog id); the cart endpoint wants `1660437` (variant SKU, found in JSON-LD `Product.sku`). The original probe sent `itemNumber` everywhere and silently got missing-arg errors.
- **`productBeanId` (addToCart response) ≠ `catalogEntryId` (cart page).** Off-by-one (2908797 vs 2908798) for the same line. Don't try to derive — scrape `catalogEntryId_N` from cart page each call.
- **45s op timeout is fatal for cold starts.** A first-call addToCart needs PDP nav (~5s) + Akamai sensor (~3s) + auth/SKU scrape + POST. Pre-warming via `page_plan.entry_url` makes acquired-page reuse much faster on subsequent calls; without it, fresh-page navigation can exceed the verify wrapper's 45s timeout.
- **Fresh-Chrome sessionStorage is empty** until the user navigates to costco.com. `refreshProfile()` copies cookies but the JWT in sessionStorage is per-tab — the runtime's PDP nav is what populates it.
