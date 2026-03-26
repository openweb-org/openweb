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
