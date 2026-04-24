## 2026-04-24 — Userflow QA: response trimming for searchTitles

**Context:** Ran 3 blind persona workflows (movie night planner, TV show binger, film buff). All 4 ops functionally correct. searchTitles responses (5.5–7.8KB) spilled to temp files due to exceeding the 4096-byte inline threshold.

**Changes:**
- Added `TITLE_SEARCH_FIELDS` GraphQL fragment — lighter than `TITLE_CORE_FIELDS`, omits `plot`, `primaryImage`, `originalTitleText`, `endYear`, `displayableProperty`
- Added `compact()` helper to strip null/undefined/empty-array fields from search results
- Removed `image` and `plot` fields from searchTitles output (available via getTitleDetail)
- Updated openapi.yaml schema to match: removed `image` and `plot` from searchTitles response, updated operation summary

**Result:** Search responses dropped from 5.5–7.8KB to 2.6–3.2KB — all queries now return inline.

**Gaps documented (not fixed — op coverage, not bugs):**
- No person search (searchPeople) — searching "Tom Hanks" returns titles about him, not his filmography
- No getPersonDetail/getFilmography op — film buff persona requires knowing an imdbId upfront

**Verification:** `pnpm dev verify imdb` — 4/4 ops PASS.



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
