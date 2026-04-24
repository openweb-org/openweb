## 2026-04-24: Userflow QA — extraction fixes

**What changed:**
- searchPapers & getCitations: fixed `authors` containing venue info and `venueYear` showing domain instead of venue — root cause: Google Scholar uses ` ` (non-breaking space) before the first ` - ` separator, so `.split(' - ')` only matched the second separator. Fixed via `String.fromCharCode(160)` normalization.
- getAuthorProfile: fixed all publication `citedBy` returning 0 — selector `.gsc_a_ac a` expected an `<a>` tag, but citation counts are plain text in `.gsc_a_ac`.
- searchPapers & getCitations: added snippet truncation to ~200 chars.

**Personas tested:**
1. PhD student — searchPapers "attention is all you need" → getCitations
2. Professor — searchPapers "author:hinton geoffrey" → getAuthorProfile (Hinton)
3. Journalist — searchPapers "CRISPR gene editing human embryos" → verify authors

**Verification:** `pnpm --silent dev verify google-scholar`

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
