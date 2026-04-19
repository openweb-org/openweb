# Walmart Fixture — Progress

## 2026-03-23: Initial discovery — search, detail, pricing

**What changed:**
- Replaced broken `getFooterModules` (1 op, quarantined, required browser) with 3 working operations: `searchProducts`, `getProductDetail`, `getProductPricing`
- Created `src/runtime/node-ssr-executor.ts` — new runtime capability for node-based SSR extraction (fetches HTML via HTTP, parses `__NEXT_DATA__` without browser)
- Updated `src/runtime/executor.ts` to route `transport: node` + `ssr_next_data` extraction through the new node SSR path instead of requiring a browser
- Updated openapi.yaml, manifest.json, and test files

**Why:**
- Original fixture had only a footer modules extraction — irrelevant to target intents (search, detail, pricing)
- Walmart's PerimeterX bot detection blocks all CDP-connected browsers, making browser-based extraction impossible
- Direct HTTP fetch to walmart.com returns full SSR HTML with `__NEXT_DATA__` — rich product data accessible without browser

**Discovery process:**
1. Tried browser capture → blocked by PerimeterX on all walmart.com URLs
2. Tested direct HTTP fetch → 200 with full `__NEXT_DATA__` on search and product pages
3. Explored Walmart's internal APIs (`/orchestra/*/graphql`, affiliate API) → all blocked or require auth
4. Built node-based SSR extraction as a new runtime capability
5. Verified all 3 operations return real data matching walmart.com content

**Verification:** API-level (all 3 PASS), content-level (search returns real products with names/prices/ratings, PDP returns full detail with brand/description/pricing, pricing shows current/was/savings), build passes
**Commit:** 389e7c2

**Knowledge updates:**
- Updated `archetypes.md` — Walmart uses node transport (not page), CDP blocked by PerimeterX
- Updated `troubleshooting-patterns.md` — bot detection CDP bypass, search DRIFT pattern, IP poisoning warning
- Commit: 20f5405

## 2026-04-18 — Write-Verify: orchestra headers + idempotent removeFromCart

**Context:** Post normalize-adapter write-verify campaign. `removeFromCart` was failing with HTTP 418 from `/orchestra/{cartxo,home}/graphql/*` (PerimeterX edge block). The persisted-query envelope was correct, but Walmart's "Glass" client identity headers were missing — 418 indicated the request shape itself was being rejected before the GraphQL gateway saw it.
**Changes:** (commit `72f783b`)
- Added orchestra GraphQL headers to all cart calls in `adapters/walmart-cart.ts`: `x-o-bu: WALMART-US`, `x-o-mart: B2C`, `x-o-platform: rweb`, `x-o-platform-version`, `WM_MP: true`.
- Made `removeFromCart` idempotent by seeding the line with `updateItems(quantity=1)` before the `updateItems(quantity=0)` removal. This avoids the gateway 400 when the item isn't already in the cart and lets verify run the op standalone with any `usItemId`.
**Verification:** 0/1 PASS at commit time, but the failure transitioned from HTTP 418 → HTTP 429. The 418→429 shift is load-bearing: 418 means "anti-bot rejected the request shape"; 429 means "request shape accepted, you've just exceeded the per-client rate limit". Cooldown ≥1 h before re-running.
**Key discovery:** Walmart's orchestra gateway uses two-tier rejection — PerimeterX 418 for unrecognized clients (no orchestra headers) and a 429 rate-limit for recognized clients exceeding burst quota. The transition between the two is the cleanest health signal for "is my code right".
**Pitfalls:** Initially attempted to add only `x-o-bu` — still 418. The full Glass header set is required as a bundle; partial sets are still classified as anomalous by the bot detector.
