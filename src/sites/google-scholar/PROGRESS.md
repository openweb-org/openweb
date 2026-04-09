## 2026-04-09: Initial add — 3 operations

**What changed:**
- Added Google Scholar site with 3 operations: searchPapers, getCitations, getAuthorProfile
- All operations use `page_global_data` extraction from DOM
- Transport: `page` (Google bot detection blocks node)

**Why:**
- Academic paper search is a key reference/lookup use case

**Verification:** 3/3 PASS with `pnpm --silent dev verify google-scholar --browser`
