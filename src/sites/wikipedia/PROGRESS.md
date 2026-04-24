## 2026-04-24: Userflow QA — param aliases, schema fixes

**Workflows tested (blind, from user perspective):**
1. Student: searchArticles → getPageExtract → getPageLinks (research "quantum entanglement")
2. Trivia: searchArticles → getPageSummary → getPageInfo → getPageMediaList (verify "Burj Khalifa")
3. Historian: searchArticles → getPageRevisions → getOnThisDay (trace "Apollo 11")

**Issues found and fixed:**

| # | Gap type | Description | Fix |
|---|----------|-------------|-----|
| 1 | param opacity | searchArticles: `srsearch` is raw MediaWiki jargon — user guesses `query` | Added `x-openweb.alias: query` on srsearch |
| 2 | param opacity | getPageBacklinks: `bltitle` is opaque — user guesses `title` | Added `x-openweb.alias: title` on bltitle |
| 3 | param inconsistency | Action API ops use `titles` (plural) vs REST ops use `title` (singular) | Added `x-openweb.alias: title` on all 5 `titles` params |
| 4 | param opacity | `srlimit`/`sroffset`/`bllimit`/`cllimit`/`pllimit`/`lllimit` — prefix jargon | Added `x-openweb.alias: limit` and `offset` aliases |
| 5 | schema mismatch | getPageMediaList: `title` required but timeline images omit it | Removed `title` from required |
| 6 | schema mismatch | getOnThisDay: `events` required but `type=selected` only returns `selected` | Removed `events` from required |

**Platform changes:**
- Added `x-openweb.alias` to XOpenWebParameter type
- Added alias resolution in param-validator.ts (resolves before unknown-name check)
- Updated navigator.ts to display alias name instead of wire name

**Not fixed (gap, not bug):**
- No operation to get article citation references (external sources). getPageLinks returns internal wikilinks only. A student wanting bibliography/citations can only parse getPageSource wikitext.

**Verification:** All 14 ops tested live. All 1049 tests pass. Lint clean.

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
