## 2026-04-17 — Phase 3 Normalize-Adapter

**Context:** Convert adapter-based ops to spec extraction primitives so the runtime drives extraction directly from `x-openweb.extraction` blocks.
**Changes:** Migrated all 4 page ops (`searchJobs`, `getJobDetail`, `getCompanyProfile`, `getSalary`) to `page_global_data` with DOM expressions embedded in `openapi.yaml`. `adapters/boss-web.ts` deleted; manifest updated. Reference data ops (node transport) unchanged.
**Verification:** 7/7 PASS via `pnpm dev verify boss --browser`.
**Commit:** `04b4f82` — feat(boss): migrate all 4 page ops to spec extraction

## 2026-04-02: Fix adapter navigation — 7/7 PASS

**What changed:**
- Renamed `navigateAndWait` → `navigateTo` matching google-search/booking/redfin pattern
- Reduced goto timeout from 30s → 15s, replaced fixed 5s wait with `waitForSelector` + `.catch(() => {})`
- Added `.catch(() => {})` on `page.goto()` to handle `ERR_ABORTED` from SPA router interception
- Simplified `init()` to permissive URL check only (removed 15s navigation attempt that hung on bot detection)
- Each operation passes targeted wait selectors (`.job-card-wrapper`, `.job-detail-section`, `.company-banner`)

**Why:**
- Systemic adapter-pattern bug: same fix applied to google-search, booking, redfin, google-flights
- Old `navigateAndWait` caused verify to hang (30s timeout + 5s fixed wait per op)
- `init()` navigation attempt added unnecessary latency and could hang on bot detection
- `ERR_ABORTED` from zhipin.com's Vue SPA router was treated as fatal; should be caught since SPA handles the route internally

**Verification:** `pnpm dev verify boss` — 7/7 PASS
**Commit:** pending

## 2026-04-01: Rediscovery — 7 operations (4 core + 3 reference data)

**What changed:**
- Rebuilt boss package from scratch with 7 operations
- Core ops (page adapter): searchJobs, getJobDetail, getCompanyProfile, getSalary
- Reference data ops (node transport): getCities, getIndustries, getFilterConditions
- Reference data APIs work via direct HTTP (no bot detection on /wapi/* endpoints)
- Core page-navigation ops remain quarantined (bot detection redirects within 1-3s)
- Adapter isAuthenticated returns true (site requires_auth: false)
- Adapter init self-navigates to zhipin.com if page is not on the right origin

**Why:**
- User-requested rediscovery targeting searchJobs, getJobDetail, getCompany, getSalary
- Added reference data ops to provide verifiable operations despite quarantine
- Discovered that Chinese site reference data APIs bypass bot detection via node transport

**Verification:** getCities PASS, getIndustries PASS, getFilterConditions PASS (3/7)
**Commit:** pending
