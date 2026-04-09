# CoinMarketCap — Progress

## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- PROGRESS.md: created
- DOC.md: fixed heading hierarchy under Site Internals (## → ###), added Extraction subsection
- openapi.yaml: added `compiled_at`, ensured `example` on all parameters, `description` on every property, `required` arrays on all objects
- All 3 example files: added `replay_safety: safe_read`, added `response_schema_valid: true` assertion

**Why:**
Align with site package quality checklist.

**Verification:** `pnpm --silent dev verify coinmarketcap`
