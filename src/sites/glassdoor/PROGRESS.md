# Glassdoor — Progress

## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- PROGRESS.md: created
- DOC.md: added `---` separator before Site Internals, tightened wording
- openapi.yaml: added `description` on all nested objects (no bare `type:object`), added `example` on required params, added `default` where applicable
- All 4 example files present with `replay_safety`

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify glassdoor`
