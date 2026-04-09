## 2026-04-09: Polish yelp site package

**What changed:**
- Fixed DOC.md heading levels (Site Internals subsections now `###`) and added internals preamble
- Added `required` arrays to both response schemas — autocompleteBusinesses (response, prefix+suggestions, title+type) and searchBusinesses (businesses, name)
- Added `description` on every property at every nesting level — no bare type-only fields across both operations
- Fixed `nullable: true` → `[type, "null"]` pattern (OAS 3.1 compliance) across all nullable fields
- Added `example` values to parameters (loc, prefix, find_desc, find_loc, start)
- Added `build` metadata (`verified: true`, `signals: [adapter-verified]`) to searchBusinesses
- Added `method` and `replay_safety: "safe_read"` to both example files

**Why:**
- Quality checklist: required fields, descriptions on all properties, OAS 3.1 nullable pattern, parameter examples, replay_safety on examples
- No new ops added — 2 ops (autocompleteBusinesses, searchBusinesses) received schema hardening only

**Key files:**
- `src/sites/yelp/openapi.yaml` — schema hardening across both ops, build metadata
- `src/sites/yelp/DOC.md` — heading level fix, internals preamble
- `src/sites/yelp/examples/*.example.json` — method + replay_safety on both files

**Verification:** pnpm build, pnpm dev verify yelp

## 2026-04-05: Initial site package — capture, compile, curate

**What changed:**
- Created Yelp site package with 2 operations: autocompleteBusinesses, searchBusinesses
- autocompleteBusinesses uses node transport (direct JSON API at /search_suggest/v2/prefetch)
- searchBusinesses uses yelp-web adapter with browser transport — dual extraction (SSR JSON + DOM fallback)
- Added example files for both operations
- Created manifest.json, DOC.md

**Why:**
- User requested Yelp site package for local business search
- Yelp blocks direct HTTP for search pages, requiring browser transport + adapter for searchBusinesses
- autocompleteBusinesses works via direct node HTTP (simple JSON API)

**Verification:** `pnpm dev verify yelp` — autocompleteBusinesses: PASS (node transport). searchBusinesses: requires `--browser` flag.
