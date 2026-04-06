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
