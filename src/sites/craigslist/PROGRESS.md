## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- PROGRESS.md: created
- openapi.yaml: added required fields, property descriptions, parameter examples, compiled_at, no bare type:object
- manifest.json: fixed stats (adapter ops are L3, not L2)

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify craigslist`

## 2026-04-09: Initial add — 3 operations

**What changed:**
- Added Craigslist site with 3 operations: searchListings, getListing, getCategories
- All operations use `craigslist-dom` adapter with multi-strategy DOM extraction
- Transport: `page` (pure server-rendered HTML, no JSON APIs)

**Why:**
- Classic US classifieds platform, widely used for apartments, jobs, and for-sale items

**Verification:** 3/3 operations verified with adapter
