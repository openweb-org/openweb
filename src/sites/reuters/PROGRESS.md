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
