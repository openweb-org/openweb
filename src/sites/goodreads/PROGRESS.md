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
