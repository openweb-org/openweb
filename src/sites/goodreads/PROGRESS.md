## 2026-04-24: QA — getBook adapter fix, operation-level transport

**What changed:**
- getBook: switched from raw `ssr_next_data` extraction (321KB Apollo cache dump) to adapter transport — response now ~2KB structured data (title, series, author, rating, description, genres, pageCount, format, isbn, awards, etc.)
- openapi.yaml: updated getBook summary and response schema to match adapter output
- All 4 ops: added operation-level `transport: node` — prevents unnecessary browser acquisition since all ops use `nodeFetch`

**Personas tested:**
1. Book club member: searchBooks("fourth wing") → getBook(61431922) → getReviews(61431922) → getAuthor(7539785) — all PASS
2. Author researching comps: searchBooks("science fiction 2025") → getBook(223830486) — all PASS
3. Gift buyer: searchBooks("project hail mary") → getBook(54493401) → getReviews(54493401) → getAuthor(6540057) — all PASS

**Friction found & fixed:**
- getBook returned 321KB raw Apollo SSR cache (unusable for agents) — adapter already existed but wasn't wired up. Root cause: openapi.yaml used `extraction: { type: ssr_next_data }` instead of `adapter: { name: goodreads, operation: getBook }`
- Intermittent `needs_page` errors on adapter ops due to missing operation-level `transport: node` — server-level transport is not sufficient for adapter dispatch

**Verification:** `pnpm dev verify goodreads`

## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- DOC.md: fixed heading hierarchy under Site Internals
- openapi.yaml: added param examples, property descriptions, no bare type:object
- All 4 example files present with replay_safety

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify goodreads`

## 2026-04-09: Initial add — 4 operations

**What changed:**
- Added Goodreads site with 4 operations: searchBooks, getBook, getReviews, getAuthor
- searchBooks, getBook, getAuthor use `page_global_data` extraction
- getReviews uses adapter (reviews load asynchronously via GraphQL)
- Transport: `page` (heavy bot detection blocks node)

**Why:**
- Goodreads is the largest book community — rich book, review, and author data

**Verification:** 4/4 PASS with `pnpm --silent dev verify goodreads --browser`

## 2026-04-17 — Phase 3 Normalize-Adapter

**Context:** Audit pass to migrate site adapters to spec extraction primitives or shared helpers.
**Changes:** Refactored `adapters/goodreads.ts` to use the injected `nodeFetch` helper (SSRF + redirect + timeout guards) in place of raw `fetch()`. All 4 ops remain on the thin adapter. Commit `33ca3ce`.
**Verification:** 4/4 PASS
**Key discovery:** Full spec extraction migration blocked because `apolloState` post-processing (Book + Work + Contributor + Review + User entity stitching) is too site-specific for generic primitives.
