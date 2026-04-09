## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- DOC.md: fixed heading hierarchy under Site Internals (## → ###)
- openapi.yaml: added `example` on all parameters, `description` on every response property
- All 3 example files: added `replay_safety: safe_read`

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify google-scholar`

## 2026-04-09: Initial add — 3 operations

**What changed:**
- Added Google Scholar site with 3 operations: searchPapers, getCitations, getAuthorProfile
- All operations use `page_global_data` extraction from DOM
- Transport: `page` (Google bot detection blocks node)

**Why:**
- Academic paper search is a key reference/lookup use case

**Verification:** 3/3 PASS with `pnpm --silent dev verify google-scholar --browser`
