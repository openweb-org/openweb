## 2026-04-11: Transport upgrade — DOM extraction → node-native HTML parsing

**What changed:**
- Rewrote `rotten-tomatoes-web.ts` adapter: replaced all `page.goto()` + `page.evaluate(DOM)` with Node.js native `fetch()` + regex HTML parsing
- All 3 ops (searchMovies, getMovieDetail, getTomatoMeter) now parse raw SSR HTML
- Zero DOM dependency: no `querySelector`, no `waitForSelector`, no web component rendering
- Updated DOC.md to reflect new architecture
- Added summary.md with full probe → discover → upgrade record

**Probe findings:**
- No internal JSON API — all data is SSR HTML
- No webpack, no patched fetch, no client-side signing
- `__RT__` global has only feature flags, not data
- `/cnapi/` endpoints found (videos, sidebar, suggestions) but none for search/movie data
- Node.js fetch returns full SSR HTML with no bot detection

**Why:**
- DOM extraction (querySelector on rendered web components) is the most fragile tier
- All needed data lives in SSR HTML: `search-page-media-row` attributes, LD+JSON, `media-scorecard` slots
- Node-native fetch eliminates dependency on browser rendering

**Verification:** `pnpm --silent dev verify rotten-tomatoes --browser` → 3/3 PASS

---

## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- openapi.yaml: added `required` arrays to all response objects, `description` on every property, `example` on all parameters, `build` sections with stable_id/verified/signals, `compiled_at`
- DOC.md: fixed heading hierarchy (Site Internals subsections `##` → `###`)
- All 3 example files: added `replay_safety: safe_read`

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify rotten-tomatoes`

## 2026-04-09: Initial site package

**What changed:**
- Created rotten-tomatoes site package with 3 operations: searchMovies, getMovieDetail, getTomatoMeter
- Adapter-based extraction: DOM attributes (search), LD+JSON + media-scorecard (detail/scores)
- Page transport (DOM extraction requires browser rendering)
- No auth required — all data is publicly accessible

**Why:**
- Rotten Tomatoes has no public API — all data is server-rendered HTML
- Search uses custom web components (`search-page-media-row`) with rich data attributes
- Movie detail pages embed LD+JSON (schema.org Movie) for structured data
- Scores live in `media-scorecard` web component slots

**Verification:** browser probe confirmed data extraction paths; build + verify pending
