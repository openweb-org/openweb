# TripAdvisor — Progress

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
