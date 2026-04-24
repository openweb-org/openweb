## 2026-04-24 — Userflow QA: fix dig paths, directions parsing, response trimming

**Context:** Blind 3-persona QA (Tourist, Foodie, Commuter) across all 14 ops revealed 5 HIGH and 2 LOW gaps caused by shifted Google Maps preview API response structures.

**Gaps found:**
| # | Gap | Severity | Root cause |
|---|-----|----------|------------|
| 1 | Transit directions always empty | HIGH | `name` field is `null` for transit; code rejected `typeof name !== 'string'` |
| 2 | Short-route driving directions empty | MEDIUM | Google returns walking-mode routes for short distances; mode filter dropped them |
| 3 | Review rating/authorName/relativeTime all null | HIGH | Rating shifted to `r[9]`; authorName and relativeTime not available from preview API |
| 4 | Photos always empty | HIGH | Dig path one level too deep: `dig(p, 0, 6, 0)` → `dig(p, 6, 0)` |
| 5 | Hours schedule always empty (status worked) | HIGH | Schedule at `info[203][0]` not `info[203][1][0]`; entry format: `[dayName, idx, date, [[hours]]]` |
| 6 | Address includes place name prefix | LOW | `info[18]` returns "Name, Address" — needed prefix strip |
| 7 | Photo dimensions wrong type | LOW | `p[6][2]` is `[w, h]` array, not scalar; `p[6][1]` is text not height |

**Fixes:**
- `parseDirectionsResponse`: Accept null name (fallback "Route"); when no routes match requested mode, return all available routes
- `getPlaceReviews`: Rating from `r[9]`; removed unavailable `authorName`/`relativeTime` fields
- `getPlaceDetails`: Reviews now include rating; address prefix stripped
- `getPlacePhotos`: Fixed iteration — iterate `info[37]` categories then items; URL at `dig(p, 6, 0)`, dimensions at `dig(p, 6, 2, 0/1)`; cap 10 photos
- `getPlaceHours`: Schedule from `info[203][0]`; day name from `entry[0]`, hours from `entry[3][0][0]`
- `getPlaceAbout`: Address prefix stripped
- `openapi.yaml`: Removed never-populated fields (authorName, relativeTime, distanceMeters, durationSeconds)

**Verification:** 14/14 ops tested. searchPlaces ✓, nearbySearch ✓, getPlaceDetails ✓, getPlaceReviews ✓, getPlacePhotos ✓, getPlaceHours ✓, getPlaceAbout ✓, getDirections (long+short) ✓, getTransitDirections ✓, getWalkingDirections ✓, getBicyclingDirections ✓, geocode ✓, reverseGeocode ✓, getAutocompleteSuggestions ✓.
**Key files:** `src/sites/google-maps/adapters/google-maps-api.ts`, `src/sites/google-maps/openapi.yaml`

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
