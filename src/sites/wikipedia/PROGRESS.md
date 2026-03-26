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
