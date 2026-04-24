# Product Hunt — Progress

## 2026-04-24 — Userflow QA

**Personas tested:**
1. Startup founder tracking launches: getToday → getPost
2. Developer finding new tools: searchProducts → getPost
3. Investor scouting deals: getPosts(LAST_WEEK) → getPost

**Issues found & fixed:**
- **Cold-start empty results** (getToday/getPosts): First run with fresh browser returned `[]` because `settle_ms: 3000` was insufficient for PH's Apollo cache to populate the homefeed. Fixed by increasing to `settle_ms: 6000`.
- **searchProducts → getPost slug mismatch**: searchProducts returns product slugs (e.g. "ai-4") but getPost navigated to `/posts/{slug}` which uses a different slug namespace. Product id 526014 ("/ai") from search resolved to a completely different product (id 283310, "AI") via the posts URL. Fixed: adapter now navigates to `/products/{slug}` first, falls back to `/posts/{slug}` if no product found.
- **Sparse product data on /posts/ pages**: getPost via `/posts/` returned empty categories, websiteUrl, followersCount, reviewsCount for many products. Navigating to `/products/` yields rich product data (e.g. Fathom: 3601 followers, 302 reviews, 4.95 rating, categories, website URL).
- **Param description misleading**: Updated slug param docs — use `productSlug` from getPosts/getToday, or `slug` from searchProducts.

**Known limitation:** getPost via `/products/{slug}` does not return post-specific vote counts (votesCount, dailyRank) since those are per-launch, not per-product. Users already have these from the list operations.

**Verification:** 4/4 ops functional, 3/3 persona workflows pass end-to-end.

## 2026-04-17 — Phase 3 Normalize-Adapter (7075e96, aea53d3)

**Context:** Move extraction logic from adapter handlers into spec `x-openweb.extraction` blocks so the runtime can drive extraction directly.
**Changes:**
- `getToday`, `getPosts`, `searchProducts` → migrated to `page_global_data` reading the Apollo Client cache (`__APOLLO_CLIENT__.cache.extract()`)
- Initial commit (7075e96) deleted the adapter entirely; follow-up (aea53d3) restored a thin adapter for `getPost` only — a single inline expression couldn't reliably resolve Product/Post/User/category refs for individual post pages
**Verification:** 4/4 PASS via `pnpm dev verify producthunt --browser`.
**Key discovery:** `page_global_data` works well for cache scans (filter by `__typename`) but cross-entity resolution requiring Apollo `__ref` walking is better left in the adapter.
