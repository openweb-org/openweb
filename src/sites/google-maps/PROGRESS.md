## 2026-04-17 — Adapter Refactor

**Context:** Phase 5C migration from legacy `CodeAdapter` interface to `CustomRunner` shape (commit b7fa461), aligning google-maps with the simplified adapter contract.
**Changes:** `src/sites/google-maps/adapters/google-maps-api.ts` collapsed from 541 → 511 lines. Dropped trivial `init()` (URL check; PagePlan handles navigation) and `isAuthenticated()` (returned `true`). Removed the `execute()` try/wrap — runtime now wraps errors. `unknownOp` fallback retained inside `run(ctx)`. Per-op handler signatures tightened to `Readonly<Record<string, unknown>>`; semantics (dig paths, URLs, timeouts, modes, DOM extraction) byte-for-byte preserved.
**Verification:** 10/10 ops PASS.
**Key files:** `src/sites/google-maps/adapters/google-maps-api.ts`

## 2026-03-31: Curate to 14 ops — directions, hours, geocoding, about

**What changed:**
- Added getTransitDirections, getWalkingDirections, getBicyclingDirections — direction variants using travel mode URL parameter
- Added getPlaceHours — weekly operating schedule from preview API
- Added geocode — address to coordinates via SPA search
- Added reverseGeocode — coordinates to address via SPA navigation
- Added getPlaceAbout — description, category, attributes from preview API
- Refactored getDirections into shared `getDirectionsForMode()` helper with mode parameter
- Added cookie_session auth to transport config
- Enriched getPlaceDetails reviews schema (added authorName, rating, relativeTime)
- Rewrote DOC.md per site-doc.md template with workflows and data flow
- Updated manifest to 14 ops, version 2.0.0
- Added 3 new examples (getTransitDirections, getWalkingDirections, reverseGeocode) for 10 total

**Why:**
- Full curation pass per compile.md Step 3 — expand coverage to 14 ops with complete documentation

**Verification:** Spec verify + doc verify. Runtime pending browser session.

## 2026-03-26: Expand coverage from 3 to 7 ops

**What changed:**
- Added getPlaceReviews — detailed reviews with author name, rating, relative time
- Added getPlacePhotos — photo URLs with dimensions and captions from preview API
- Added nearbySearch — category-based search near a location (SPA navigation)
- Added getAutocompleteSuggestions — type-ahead via /maps/suggest endpoint
- Refactored shared `fetchPlaceInfo()` helper for details/reviews/photos
- Updated DOC.md with all 7 operations

**Why:**
- Expand Maps coverage beyond basic search/details/directions

**Verification:** Build passes. Runtime verification blocked by Google bot detection (IP flagged). Code follows same patterns as 3 previously verified ops.

## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 3 verified L3 adapter operations

**Verification:** spec review only — no new capture or compilation
