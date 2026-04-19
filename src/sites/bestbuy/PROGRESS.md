# Best Buy — Progress

## 2026-03-23: Initial discovery and fixture creation

**What changed:**
- Created bestbuy with 3 operations: searchProducts, getProductDetails, getProductPricing
- Updated archetypes.md with detailed Best Buy API patterns

**Why:**
- M26 site discovery task — target intents: search products by keyword, get product detail page, get product pricing

**Discovery notes:**
- Captured 384 requests via CDP browser on bestbuy.com (homepage → search "laptop" → attempted PDP navigation)
- PDP navigation blocked by Akamai (HTTP/2 protocol errors) — had to rely on APIs instead of page data
- Compiler rejected all captured traffic ("No filtered samples after analyzer filtering stage")
- Identified 3 useful APIs by analyzing HAR traffic: suggest/suggest, suggest/products, api/3.0/priceBlocks
- Verified APIs work via browser_fetch (page.evaluate) but not direct HTTP
- Built fixture manually with page transport + cookie_session auth

**Verification:**
- API-level: `pnpm dev verify bestbuy` → PASS (getProductPrices)
- Content-level: searched "headphones", compared DOM products vs API responses — names, ratings, prices all match
- Build: `pnpm build` → exits 0

**Commit:** b997744

## 2026-03-31: Add example fixtures and update DOC.md

**What changed:**
- Created `examples/` with 3 example files: searchProducts, getProductDetails, getProductPricing
- Updated DOC.md: added Workflows, Quick Start, data-flow annotations (← source) in Operations table

**Why:**
- Site had 0 examples — `openweb verify bestbuy` failed with no test cases
- DOC.md was missing required sections per site-doc.md template

**Verification:** `openweb verify bestbuy` → PASS (3/3 operations)
**Commit:** ad290b5

## 2026-04-19 — Write-Op Verify Campaign

**Context:** Per `doc/todo/write-verify/handoff.md` §3.10, `removeFromCart` had been shipped against a speculative endpoint `/cart/api/v1/removeFromCart` that does not exist on bestbuy.com. The original "PASS" was a permission-gate false-positive. Goal: capture the real endpoint and chain it after `addToCart`.

**Changes:**
- `removeFromCart` rewritten: `POST /cart/api/v1/removeFromCart` (with `{items:[{lineId}]}` body) → `DELETE /cart/item/{lineId}` (path param, no body). Response schema replaced — real shape is `{ order: { id, cartItemCount, lineItems[], orderSkus[], ... } }`, not the slim `{cartCount, cartSubTotal, summaryItems[]}` we had guessed.
- `addToCart` marked `verified: true` (was `false`). Endpoint and shape were already correct; only a fixture was missing.
- Added `examples/addToCart.example.json` with `order: 1` and a sellable SKU (`6472356`, an HDMI cable). Updated `examples/removeFromCart.example.json` with `order: 2` and `${prev.addToCart.summaryItems.0.lineId}` cross-op chain.
- SKILL.md / DOC.md rewritten to reflect the real endpoints, the JSON-vs-SPA-HTML pitfall, and the new chain.

**Verification:** `pnpm dev verify bestbuy --write --browser --ops "addToCart,removeFromCart"` → 2/2 PASS. Live round-trip on a real Best Buy account observed cart go from 0 → 1 → 0 with proper JSON responses on both legs.

**Key discovery:** **Spec'd-but-nonexistent paths under `/cart/` return `200 text/html` (SPA shell), not `404 application/json`.** A POST to the original speculative path, `/cart/api/v1/cart/items/delete`, `/cart/api/v1/deleteItems`, `/cart/api/v1/delete` — all 200/HTML. Only `DELETE /cart/item/{lineId}` (and sibling DELETE routes) hit the real cart-mutation router and reply with JSON. Status-only verifiers can't distinguish "operation succeeded" from "we hit the SPA wildcard"; always assert `content-type: application/json` plus a body field.

**Pitfalls encountered:**
- First `addToCart` test SKU `6452872` (AAA batteries) returned `400 ITEM_NOT_SELLABLE`. Many store-pickup-only items behave this way; HDMI cable `6472356` is the reliable sellable test SKU.
- `verifySite` reads from the installed copy at `~/.openweb/sites/bestbuy/`, not `src/sites/bestbuy/`. Source-only edits give `0/0 ops` until the installed copy is synced (or the dev fallback path is forced).
- Per-op `--ops` filter works only when `operation_id` inside the example file matches; new fixtures need this field even when the filename already encodes the op id.
- Aggregate `pnpm dev verify bestbuy --write --browser` intermittently fails the read ops with "browser context closed" / port-bound errors when the user's Chrome on `:9222` is IPv6-only. Verify connects via `127.0.0.1`; `lsof -iTCP:9222 -sTCP:LISTEN` confirms the bind. Environmental, unrelated to this fix; the `--ops` subset run is clean.

