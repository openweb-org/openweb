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
