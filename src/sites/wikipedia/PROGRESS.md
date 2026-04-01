## 2026-04-01: Expand to 14 operations, page transport, full curation

**What changed:**
- Added 8 new operations: getPageCategories, getPageLinks, getPageBacklinks, getPageLanguageLinks, getPageInfo, getPageExtract, getOnThisDay, getFeaturedContent
- Switched transport from node to page with cookie_session auth
- All Action API ops now use formatversion=2 for array-based responses
- Enriched bare type:object schemas (namespace, titles, thumbnail, originalimage, content_urls)
- Improved all summaries with 3-5 key response fields
- Rewrote DOC.md per site-doc.md template with workflows and data flow annotations
- Added 4 new example files (10 total)

**Why:**
- Full curation pass per compile.md Step 3 — expand coverage across all three Wikipedia APIs

**Verification:** All three verify dimensions (runtime, spec, doc)

## 2026-03-26: Expand coverage from 2 to 6 operations

**What changed:**
- Added 4 new operations: getPageSource, getPageMediaList, getRandomArticle, getPageRevisions
- Discovered Core REST API (`/w/rest.php/v1/`) for article source and revision history
- All 6 operations verified PASS with node transport

**Why:**
- Expand from basic search+summary to full article content, media, random, and history

**Verification:** API-level — all 6 ops return 200 with valid schema

## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 2 verified operations across MediaWiki Action API and REST v1

**Verification:** spec review only — no new capture or compilation
