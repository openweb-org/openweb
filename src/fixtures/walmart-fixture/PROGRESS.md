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
