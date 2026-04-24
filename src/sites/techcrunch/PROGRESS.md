## 2026-04-24: Userflow QA — response trimming adapter

**What changed:**
- Added `adapters/techcrunch.ts`: nodeFetch-based adapter for all 4 ops (searchArticles, getArticle, getLatest, getCategory)
- Response trimming strips `_embedded` (1.2MB/article wp:term data), `yoast_head`, `yoast_head_json`, `parsely`, `_links`, `meta`, `class_list`, and 15+ other WordPress noise fields
- Extracts author name from `yoast_head_json.author` (was numeric ID), section/keywords from `parsely.meta` (getArticle)
- `featured_media` (numeric ID) → `featured_image_url` (actual URL via `jetpack_featured_media_url`)
- Removed `_embed` param from all ops — `_embed=1` caused 8x slower responses (5.9s vs 0.7s) and `yoast_head_json` provides author names without it
- Updated openapi.yaml: adapter refs on all 4 ops, flattened schemas (title/excerpt/content from `{rendered: string}` to plain string)

**Size reduction:**
- List ops: ~6.3MB → ~2KB (3 items) — 99.9% reduction
- getArticle: ~1.3MB → ~10KB — 99.2% reduction
- No responses truncated post-fix

**Personas tested:**
1. VC analyst: getLatest → searchArticles "Series A" ✓
2. Startup founder: searchArticles "Stripe" → getArticle ✓
3. Tech enthusiast: getLatest → getCategory (AI, Startups) ✓

**Verification:** `pnpm --silent dev verify techcrunch`

## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- DOC.md: fixed heading hierarchy under Site Internals, added ← annotations and entry points in Operations table
- openapi.yaml: added `required: [rendered]` to title/excerpt/content objects (no bare type:object), verified all required fields
- All 4 example files present with `replay_safety` and `response_schema_valid`

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify techcrunch`
