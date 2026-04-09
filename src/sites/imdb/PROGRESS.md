## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- PROGRESS.md: created
- openapi.yaml: added `compiled_at`, `requires_auth`, `example` on all parameters, `required` arrays on all response objects, `required` on nested item objects (credits, histogram)
- All 4 example files: added `replay_safety: safe_read`

**Why:**
Align with site package quality checklist.

**Verification:** `pnpm --silent dev verify imdb`
