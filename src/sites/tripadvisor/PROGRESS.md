# TripAdvisor — Progress

## 2026-04-25 — Userflow QA (BLOCKED: DataDome)

**Context:** Userflow QA — test 3 blind persona workflows end-to-end, find and fix gaps.

### Designed Workflows

**Workflow 1 — "Plan a weekend trip to Paris"** (Tourist persona)
1. `searchLocation '{"query":"Paris"}'` → get geoId + locationSlug
2. `searchHotels '{"geoId":"<id>","location":"<slug>"}'` → browse hotels
3. `getHotelDetail '{"geoId":"<id>","locationId":"<hotelId>","slug":"<slug>"}'` → check amenities, rating
4. `searchRestaurants '{"geoId":"<id>","location":"<slug>"}'` → find restaurants nearby
5. `getRestaurant '{"geoId":"<id>","locationId":"<restId>","slug":"<slug>"}'` → check cuisine, hours

**Workflow 2 — "Explore NYC attractions"** (Sightseeing persona)
1. `searchLocation '{"query":"New York City"}'` → get geoId
2. `getAttractionDetail '{"geoId":"60763","locationId":"104365","slug":"Statue_of_Liberty-New_York_City_New_York"}'` → check hours, description
3. `getAttractionReviews '{"geoId":"60763","locationId":"104365","slug":"Statue_of_Liberty-New_York_City_New_York"}'` → read reviews
4. `searchRestaurants '{"geoId":"60763","location":"New_York_City_New_York"}'` → find dinner spot

**Workflow 3 — "Find top-rated restaurants in Tokyo"** (Foodie persona)
1. `searchLocation '{"query":"Tokyo"}'` → get geoId + locationSlug
2. `searchRestaurants '{"geoId":"<id>","location":"<slug>"}'` → browse restaurant list
3. `getRestaurant '{"geoId":"<id>","locationId":"<restId>","slug":"<slug>"}'` → check cuisine, reviews, hours

### Blocker: DataDome CAPTCHA

DataDome bot detection blocks all TripAdvisor operations on this headless Chrome 114 (Linux) instance. Tested approaches:
- Fresh browser profile (temp dir each restart): blocked after first page nav
- CDP cookie clearing + re-navigation: one transient success (searchLocation returned `{"count":0,"results":[]}` — likely TypeAheadJson denied without valid session cookies), then immediately blocked again
- Non-headless mode: fails on desktop (no display / X server)
- Multiple browser restarts with clean state: blocked consistently

The block is IP + headless fingerprint level. DataDome detects Chrome 114 headless despite `--disable-blink-features=AutomationControlled` flag.

### Code Review Findings (no live testing)

**Extraction quality:** All 6 spec-based ops use `page_global_data` with inline LD+JSON parsing expressions. These already produce clean, trimmed JSON (structured fields only — name, rating, address, hours, etc.). No response bloat adapter needed — the extraction JS itself is the trimmer.

**searchLocation adapter:** Uses in-page `fetch()` to TypeAheadJson endpoint. The empty result (`count:0`) on the one successful attempt suggests the endpoint may require DataDome session cookies that aren't present on a fresh page. The adapter's silent `catch { return { count: 0, results: [] }; }` swallows the actual error.

**Potential issue — searchLocation silent failure:** The adapter catches all fetch errors and returns empty results instead of surfacing the error. This masks failures (HTTP 403, missing cookies, changed endpoint). Consider propagating the error.

### Resolution Path

To unblock, one of:
1. Solve DataDome CAPTCHA in non-headless browser (requires display — run from laptop or add X forwarding)
2. Upgrade to newer Chrome with better stealth (Chrome 120+ with `--headless=new` has improved fingerprint)
3. Add a DataDome warm-up config (`x-openweb.page_plan.warm`) with cookie stabilization, similar to the Akamai pattern in `warm-session.ts`

## 2026-04-17 — Phase 3 Normalize-Adapter (cb44577)

**Context:** Move extraction logic from adapter handlers into spec `x-openweb.extraction` blocks so the runtime can drive extraction directly.
**Changes:**
- `searchHotels`, `getHotelDetail`, `searchRestaurants`, `getRestaurant`, `getAttractionDetail`, `getAttractionReviews` → migrated to `page_global_data` (LD+JSON parsing with DOM fallbacks)
- `searchLocation` → kept on `tripadvisor` adapter (in-page `fetch()` to TypeAheadJson endpoint)
- Adapter shrunk from ~480 lines to ~106 lines; retained DataDome CAPTCHA gate around all ops
**Verification:** 7/7 PASS via `pnpm dev verify tripadvisor --browser`.

## 2026-04-17 — Adapter Refactor (5627958)

**Context:** Migrate adapter from legacy `CodeAdapter` interface to the shared `CustomRunner` (`run(ctx)`) shape so all sites converge on one adapter contract.
**Changes:**
- `adapters/tripadvisor.ts`: 119 → 105 lines; imports `CustomRunner`, `PreparedContext`, `AdapterHelpers` from shared `types/adapter`; local `CodeAdapter` shim removed
- Dropped stub `init()` (PagePlan covers the `tripadvisor.com`/`about:blank` URL check) and stub `isAuthenticated()`
- DataDome CAPTCHA wait preserved byte-for-byte: `isDataDomeBlocked` + `waitForCaptchaResolution` stay top-level; the pre-op block check moved verbatim into the `run()` preamble before handler dispatch
- Param/op errors switched to `helpers.errors.missingParam('query')` and `helpers.errors.unknownOp(operation)`
- `searchLocation` handler logic unchanged
**Verification:** 7/7 ops PASS.
**Key files:** `src/sites/tripadvisor/adapters/tripadvisor.ts`, `src/sites/tripadvisor/DOC.md`, `src/sites/tripadvisor/PROGRESS.md`
