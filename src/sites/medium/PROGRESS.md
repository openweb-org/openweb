## 2026-04-18 — Write-op verify: clapArticle + unsaveArticle fixed

**clapArticle:** Spec was missing `numClaps` query param. Adapter accepted the
value but the param-validator rejected unknown keys. Added `numClaps` (1–50,
default 1) to the operation parameters.

**unsaveArticle:** Upstream removed `removeFromPredefinedCatalog`; reading-list
removal now uses `editCatalogItems(catalogId, version, operations: [{delete:
{itemId}}])`. The mutation expects `catalogItemId` (not `postId`), so the
adapter first calls `getPredefinedCatalog(userId, READING_LIST).itemsConnection`
to map `postId → catalogItemId(s)`, then deletes all matching entries.
Discovered via response-shape probing after introspection was denied
(`__schema`/`__type` blocked). Fragment names in queued GraphQL fragments
(`editCatalogItemsMutation_postViewerEdge`) gave the lead.

Verified PASS for all 5 write ops via
`verify medium --write --browser --ops clapArticle,followWriter,saveArticle,unfollowWriter,unsaveArticle`.

## 2026-04-14 — Transport Upgrade Probe: No __NEXT_DATA__, GraphQL works from node

**Context:** Investigated `__NEXT_DATA__` extraction for transport upgrade.
**Findings:**
- Medium is not a Next.js site — no `__NEXT_DATA__`, no `_next/` assets
- Tag pages have `__APOLLO_STATE__` (window global) with ~15 Post objects and rich fields. Fetchable from node HTTP (200). Article/search pages do not have it.
- **Key discovery:** Medium's `/_/graphql` endpoint accepts standard (non-batched) `{ query, variables }` POST from node HTTP with Chrome UA. All 5 read queries tested return 200 with valid data. No auth, cookies, or bot detection required for reads.
- Tier 7 (node direct) upgrade is technically feasible for all GraphQL read ops (getArticle, getTagFeed, getTagWriters, getTagCuratedLists, getRecommendedFeed, getRecommendedTags, getPostClaps, getRecommendedWriters)
**Blockers for node upgrade:**
- Current adapter does Relay connection flattening (`edges[].node` → flat array), field renames (`normalizedTagSlug` → `slug`), and custom response shaping
- Switching to node transport requires either restructuring all operation schemas to match raw GraphQL shapes, or building a post-processing layer
- Write ops (clap, follow, save) need auth cookies — must stay on page transport
**Decision:** No `__NEXT_DATA__` extraction possible. GraphQL-from-node is documented as a future upgrade opportunity. Staying on `transport: page` with adapter.

## 2026-04-01: Fresh rediscovery — 13 ops via GraphQL adapter

**What changed:**
- Rediscovered Medium from scratch with fresh capture
- 13 operations: 10 read (7 GraphQL, 2 DOM, 1 GraphQL detail), 3 write
- Added `getArticle` operation (single post by ID) — replaces prior `getPublicationPosts`
- Fixed `networkidle` → `load` + wait in DOM operations (search, profile)
- Compile pipeline cannot sub-cluster GraphQL — L3 adapter required

**Why:**
- Prior package deleted in batch cleanup; fresh discovery for batch1

**Verification:** adapter-verified via runtime exec (getTagFeed, getArticle, searchArticles, getUserProfile)
**Commit:** pending
