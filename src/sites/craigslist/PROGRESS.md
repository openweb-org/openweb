## 2026-04-24: Userflow QA — response trimming and fixes

**What changed:**
- searchListings: capped results to 25 (was 300+), removed always-null `date` field, normalized `$0` price to null
- getListing: trimmed body to 800 chars, capped images to 5, updated stale verify example (410 Gone)
- Both adapters (node + DOM) aligned on the same trimming limits
- openapi.yaml: dropped `date` from search schema, updated getListing category description to document subregion prefix

**Why:**
- Raw search responses were ~88KB (352 listings), far too large for LLM context
- Job listings showed `$0` price instead of null
- Verify example pointed to a deleted listing

**Verification:** `pnpm dev verify craigslist` — 3/3 PASS

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
