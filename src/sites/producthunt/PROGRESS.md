# Product Hunt — Progress

## 2026-04-17 — Phase 3 Normalize-Adapter (7075e96, aea53d3)

**Context:** Move extraction logic from adapter handlers into spec `x-openweb.extraction` blocks so the runtime can drive extraction directly.
**Changes:**
- `getToday`, `getPosts`, `searchProducts` → migrated to `page_global_data` reading the Apollo Client cache (`__APOLLO_CLIENT__.cache.extract()`)
- Initial commit (7075e96) deleted the adapter entirely; follow-up (aea53d3) restored a thin adapter for `getPost` only — a single inline expression couldn't reliably resolve Product/Post/User/category refs for individual post pages
**Verification:** 4/4 PASS via `pnpm dev verify producthunt --browser`.
**Key discovery:** `page_global_data` works well for cache scans (filter by `__typename`) but cross-entity resolution requiring Apollo `__ref` walking is better left in the adapter.
