## 2026-04-01: Initial discovery and compile

**What changed:**
- Discovered Substack REST API endpoints via browser capture
- Built adapter for multi-subdomain routing (publications on different domains)
- 5 operations: searchPosts, getArchive, getPost, getPostComments, getTrending

**Why:**
- Initial site package creation targeting getPost, getPublication, searchPosts, getComments

**Verification:** adapter-verified, capture-based discovery on astralcodexten.substack.com

## 2026-04-17 — Phase 3 Pure-Spec Migration

**Context:** Phase 3 of normalize-adapter — migrate adapter-backed ops to declarative OpenAPI.
**Changes:** All 5 ops moved to pure spec. Adapter file deleted.
- searchPosts, getTrending: default substack.com server.
- getArchive, getPost, getPostComments: per-op `servers` with `https://{subdomain}.substack.com` variable (Phase 1.5 server-variable threading).
- Real `/api/v1/*` paths now in spec (no more virtual paths).
- Response schemas already matched raw API; no transformation removed.
**Verification:** `pnpm dev verify substack` originally 5/5 PASS; re-verify intermittent — `getArchive`, `getPost`, `getPostComments` flaky with `browser_fetch failed: page.evaluate: TypeError: Failed to fetch` (DataDog RUM intercept on cross-subdomain page context). `getTrending`, `searchPosts` consistently PASS.
**Pitfalls:** subdomain declared as `in: query` so param-validator accepts it; substituteServerVariables consumes it; the extra `&subdomain=` query pair is ignored by the API. If verify flakiness persists, candidate revert: keep adapter for the 3 cross-subdomain ops.
