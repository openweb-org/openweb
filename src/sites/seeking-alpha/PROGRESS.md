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
