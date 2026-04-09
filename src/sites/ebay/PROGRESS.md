# eBay — Progress

## 2026-04-09: Polish site package

**What changed:**
- openapi.yaml: added `compiled_at`, per-op `build` metadata (stable_id, signals), embedded extraction expressions
- openapi.yaml: added `required` arrays and descriptions on all nested objects — no bare `type: object` remaining
- openapi.yaml: added `example` values on all parameters
- DOC.md: fixed heading hierarchy (Site Internals subsections now ### not ##)

**Verification:** `pnpm build && pnpm --silent dev verify ebay`

## 2026-04-09: Initial site package

**What changed:**
- Added eBay as new site with 3 operations: searchItems, getItemDetail, getSellerProfile
- Adapter-based package using page transport with DOM/LD+JSON extraction
- All operations verified PASS

**Why:**
- eBay is a major e-commerce platform with no prior OpenWeb support

**Verification:** All 3 ops pass verify (searchItems, getItemDetail, getSellerProfile). Build passes.
