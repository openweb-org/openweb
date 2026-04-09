## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- DOC.md: fixed heading hierarchy under Site Internals, added ← annotations and entry points in Operations table
- openapi.yaml: added `required: [rendered]` to title/excerpt/content objects (no bare type:object), verified all required fields
- All 4 example files present with `replay_safety` and `response_schema_valid`

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify techcrunch`
