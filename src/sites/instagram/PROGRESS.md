## 2026-03-30: Release QA — examples, verify, doc review

**What changed:**
- Added 9 example files for all GET/read operations
- Updated mediaId placeholders to use realistic values from DOC.md
- Reviewed and confirmed DOC.md completeness (overview, ops table, auth, quick-start, known issues)
- Reviewed all 15 operationIds — no noise, all meaningful

**Verification:** `pnpm dev verify instagram --browser` — 9/9 read ops PASS
- Write ops not verified (require side effects)

**Known gaps:**
- GraphQL endpoints not yet covered
