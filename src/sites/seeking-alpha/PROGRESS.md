## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- openapi.yaml: added `required` arrays to all response objects, `description` on every property, `example` on all parameters, `build` sections with stable_id/verified/signals
- DOC.md: fixed heading hierarchy (Site Internals subsections `##` → `###`)
- All 4 example files: added `replay_safety: safe_read`

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify seeking-alpha`

## 2026-04-09: Initial site package

**What changed:**
- Added 4 operations: searchArticles, getArticle, getStockAnalysis, getEarnings
- Adapter-based with pageFetch (page transport due to heavy bot detection)
- Handles premium-locked ratings, ticker ID resolution, dormant PX captcha cleanup

**Why:**
- New site addition — investment research and analysis platform

**Verification:** All 4 ops PASS via `pnpm dev verify seeking-alpha --browser`

## 2026-04-17 — Phase 3 Pure-Spec Migration

**Context:** Phase 3 of normalize-adapter.
**Changes:** searchArticles and getArticle migrated to pure spec:
- `/api/v3/searches/all` and `/api/v3/articles/{articleId}` paths.
- JSON:API bracket params (`filter[query]`, `page[size]`, `page[number]`, `filter[period]`, `filter[list]`, `include`) declared as query parameters; URLSearchParams encodes them through correctly and SA accepts them.
- Response schemas relaxed to raw JSON:API shape (`additionalProperties: true`).
- getStockAnalysis and getEarnings kept adapter-backed: both compose multiple parallel upstream calls (3 for analysis; ticker-id lookup + 2 for earnings) and reshape deeply nested response maps. Not declaratively expressible today.
- Adapter trimmed to the two remaining ops.
**Verification:** `pnpm dev verify seeking-alpha` → 4/4 PASS.
