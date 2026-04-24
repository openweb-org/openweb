## 2026-03-31: Curate — enrich schemas, fix examples, update DOC.md

**What changed:**
- Enriched all 14 bare `type: object` response schemas with actual field definitions (2-3 levels deep)
- Fixed example files: replaced invalid `"id": 1` with real Douban IDs (1292052, 2567698)
- Created missing example files for 4 adapter ops (getMoviePhotos, getTop250, searchMusic, getMusicDetail)
- Added `cookie_session` auth config to server block
- Rewrote DOC.md per site-doc.md template: Workflows with data flow, Operations table with `← source` annotations, Quick Start

**Why:**
- Bare schemas gave agents no information about response fields
- Invalid example IDs caused verify failures (404) for all detail endpoints
- DOC.md lacked cross-operation data flow and workflow guidance

**Verification:** Runtime verify pass (10 API ops), spec curation standards, doc template compliance

## 2026-04-17 — Phase 3 Normalize-Adapter

**Context:** Audit pass to remove dead adapter code across sites where the spec already covered all operations.
**Changes:** Deleted unreferenced `adapters/douban-dom.ts` (349 lines). Spec already routed all 14 ops through the L1 mobile JSON API; adapter file was unused. Commit `b38e86b`.
**Verification:** 14/14 PASS

## 2026-04-24 — Userflow QA: response trimming and fixes

**Context:** Douban's mobile JSON API returns massive raw responses with internal metadata (douban:// URIs, color schemes, variable_modules, full user objects with registration times, sharing URLs, wechat configs). Responses ranged 5–80KB per call, wasting agent tokens on noise.

**Personas tested:**
1. 影迷 — getNowShowingMovies → getMovie → getMovieReviews → getMovieCelebrities → getMoviePhotos
2. 书虫 — searchBooks → getBook → getBookReviews
3. 活动爱好者 — searchMusic → getMusicDetail; getRecentHotMovies, getRecentHotTv, getTop250

**Gaps found & fixed:**
- **Response bloat (all 14 ops):** Created `adapters/douban-read.ts` — CustomRunner adapter that fetches from Douban mobile API and trims responses to schema-declared fields only. Size reductions: getNowShowingMovies 18KB→9KB, getMovieReviews 23KB→4.5KB, getMovieCelebrities 20KB→7.6KB, getMoviePhotos 26KB→6.7KB, getTop250 80KB→10KB, getBookReviews 22KB→5.6KB
- **Schema type mismatch:** `star_count` was `integer` in getMovie/getMovieReviews/getBookReviews schemas but API returns floats (4.5). Changed to `type: number`
- **Missing transport declaration:** Added `transport: node` to all 14 operation-level x-openweb blocks (runtime requires operation-level declaration to skip browser acquisition for adapter ops)
- **Removed internal-only fields from schemas:** Dropped `uri` (douban:// deep links) and `url` (web URLs) from response schemas for getMovie, getBook, getMusicDetail, getRecentHotMovies, getRecentHotTv, getTop250 — these are internal navigation URIs, not useful to agents
- **Added missing schema fields:** `trailers` array in getMovie, `ip_location` in reviews, `null_rating_reason` in listings, `abstract` in search targets
- **Bumped tool_version:** All 14 ops from v2 → v3

**Verification:** `verify douban` — 14/14 PASS
