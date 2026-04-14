## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- PROGRESS.md: created
- openapi.yaml: added `compiled_at`, `requires_auth`, `example` on all parameters, `required` arrays on all response objects, `required` on nested item objects (credits, histogram)
- All 4 example files: added `replay_safety: safe_read`

**Why:**
Align with site package quality checklist.

**Verification:** `pnpm --silent dev verify imdb`

## 2026-04-14 — Transport Upgrade: getRatings (LD+JSON + title page SSR)

**Context:** getRatings navigated to a separate `/ratings/` page for histogram data via `querySelector('#__NEXT_DATA__')`. Title page contains both LD+JSON `aggregateRating` and histogram in `__NEXT_DATA__`.
**Changes:**
- Switched getRatings from navigating to `/title/{id}/ratings/` to `/title/{id}/` (title page)
- Extract LD+JSON `aggregateRating` (schema.org structured data — more stable than framework-specific SSR)
- Extract histogram from title page `__NEXT_DATA__` at `mainColumnData.aggregateRatingsBreakdown.histogram.histogramValues`
- Eliminates separate ratings page navigation — one page load serves both aggregate and histogram
- Added `ld_json` signal to openapi.yaml
**Key discovery:** Title page `__NEXT_DATA__` contains full histogram data at `mainColumnData.aggregateRatingsBreakdown`, eliminating the need for the separate `/ratings/` page.
**Verification:** `pnpm dev verify imdb --browser` — 4/4 ops PASS.
