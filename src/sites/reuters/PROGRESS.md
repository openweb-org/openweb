## 2026-04-01: Initial discovery and compile

**What changed:**
- Discovered Reuters Arc Publishing (PageBuilder Fusion) API pattern
- Created adapter-based site package with 4 operations: searchArticles, getArticle, getTopicArticles, getMarketQuotes
- API requires browser session (401 on direct Node.js requests) — page transport with adapter

**Why:**
- Reuters uses a JSON-encoded query parameter pattern that the auto-compiler collapses into one generic endpoint
- DataDome bot detection prevents node transport
- Manual adapter required for proper parameter handling

**Verification:** API-level — all 4 operations return valid JSON from browser context
**Commit:** pending

## 2026-04-13 — Fix: adapter init navigation + schema relaxation

**Context:** Reuters adapter `init()` returned false when the browser tab was on a blank or unrelated page, causing silent operation failures. The `id` field in getArticleDetail was required but the DOM fallback strategy does not always produce it.
**Changes:** `init()` now navigates to reuters.com if the page is not already there (also recognizes DataDome captcha redirects as valid). Made `id` optional in getArticleDetail response schema — DOM fallback path does not extract Arc `_id`.
**Verification:** `pnpm build` passes. Adapter initializes correctly from blank tabs.

## 2026-04-17 — Phase 3 Normalize-Adapter

**Context:** Audit pass to migrate site adapters to spec extraction primitives or shared helpers.
**Changes:** Refactored `adapters/reuters-api.ts` to use the injected `pageFetch` helper (browser-origin fetch through patchright Page) instead of inline `page.evaluate(fetch(...))`. All 4 ops stay on the adapter. Commit `6ceadc5`.
**Verification:** 4/4 PASS
**Key discovery:** Full spec extraction migration blocked because the DataDome-gated PF API requires browser-origin fetch, and the `page_global_data` extraction primitive blocks any `fetch(` call.

## 2026-04-24 — Userflow QA: response trimming

**Context:** Blind persona testing (financial analyst, geopolitics researcher, journalist) revealed massive response bloat — 16-25KB for 5 articles due to internal PF API fields (revision_id, display_* booleans, ad_topics, kicker, content_code, source, headline_feature) and deeply nested author/thumbnail objects.
**Changes:**
- Added `trimArticle`/`trimListResponse` — strips 20+ internal fields per article, slims authors to name+topic_url, thumbnails to url+caption+alt_text, pagination to size+total_size
- Added `trimArticleBody` — strips Reuters boilerplate ("Reporting by...", "Our Standards: Thomson Reuters Trust Principles...")
- Added `trimDetailAuthors` — filters spurious "/sitemap/authors/" nav element from getArticleDetail
**Verification:** 4/4 PASS. Response sizes: getTopNews 25KB→5.4KB, getTopicArticles 18KB→5KB, searchArticles 16KB→5.3KB (67-78% reduction). getArticleDetail body clean, authors correct.
