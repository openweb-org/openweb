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
**Commit:** TBD
