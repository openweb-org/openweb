## 2026-04-17 — Phase 3 Normalize-Adapter

**Context:** Convert adapter-based ops to spec extraction primitives so the runtime drives extraction directly from `x-openweb.extraction` blocks.
**Changes:** `searchBusinesses` migrated from `yelp-web` adapter to `page_global_data` (SSR JSON parsing + DOM fallback expression embedded in `openapi.yaml`). `adapters/yelp-web.ts` deleted. `autocompleteBusinesses` (node transport) unchanged.
**Verification:** 2/2 PASS via `pnpm dev verify yelp --browser`.
**Commit:** `dc2062a` — feat(yelp): migrate searchBusinesses to spec extraction

## 2026-04-14: Transport upgrade investigation — blocked by DataDome

**What changed:**
- Probed Yelp for node-viable search APIs and transport upgrade feasibility
- Discovered DataDome now blocks all automated browsers (Patchright) — serves CAPTCHA iframe instead of pages
- Tested 8 API endpoint patterns from node: only `/search_suggest/v2/prefetch` (autocomplete) works
- `/search/snippet` exists but is DataDome-protected (403)
- No GraphQL endpoint found; Yelp Fusion API (v3) requires OAuth
- Updated DOC.md with full probe results, bot detection section, and transport upgrade evidence
- Updated SKILL.md to note DataDome blocking on searchBusinesses
- Noted that existing searchBusinesses adapter is currently broken by DataDome policy change

**Why:**
- Transport upgrade task (rq2-tr-yelp) — attempted to move searchBusinesses from page to node or higher tier
- DataDome completely blocks both node HTTP and automated browsers for search endpoints
- This is a DataDome policy change since the adapter was last verified (2026-04-06)

**Key files:**
- `src/sites/yelp/DOC.md` — bot detection section, transport upgrade investigation table, updated known issues
- `src/sites/yelp/SKILL.md` — DataDome note on searchBusinesses

**Verification:** `autocompleteBusinesses` confirmed working on node. `searchBusinesses` blocked by DataDome on all transports.

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
