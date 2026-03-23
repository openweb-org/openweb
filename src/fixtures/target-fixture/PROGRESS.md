# Target Fixture — Progress

## 2026-03-23: Initial discovery and fixture creation

**What changed:**
- Created `target-fixture` with 3 operations: `searchProducts`, `getProductDetail`, `getStoreAvailability`
- All operations use `node` transport on `redsky.target.com` with static API key
- Added test cases for all 3 operations
- Updated `doc/knowledge/archetypes.md` with Target-specific patterns
- Updated `doc/knowledge/auth-patterns.md` with Target's no-auth API subdomain pattern

**Why:**
- Target was requested as a new discovery target for product search, product details, and store availability
- User was logged in on managed browser at CDP localhost:9222

**Discovery notes:**
- Browsed target.com homepage, search (headphones, laptop), product detail (Shokz OpenRun, HP laptop), store availability ("Check other stores" dialog)
- Captured 373 requests across 15 pages (10.6MB HAR)
- Compiler rejected all traffic — `No filtered samples after analyzer filtering stage` — manual fixture creation was required
- Identified key APIs by analyzing HAR: `plp_search_v2` (search, 245KB), `pdp_client_v1` (PDP, 90KB), `fiats_v1` (store availability, 45KB)
- Initially tried `page` transport — failed because `findPageForOrigin` can't match `redsky.target.com` subdomain to `www.target.com` page
- Switched to `node` transport — all Redsky APIs respond without bot detection or auth cookies
- Search API returns HTTP 206 (Partial Content), required test assertion update

**Verification:** All 3 operations PASS with `openweb verify target-fixture` (API-level). Content verified against browser: search returns matching product titles/prices, PDP returns full detail matching visible page, store availability returns matching stock levels and store names.
