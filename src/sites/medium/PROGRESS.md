## 2026-04-18 — Write-op verify: clapArticle fixed; unsaveArticle blocked

**clapArticle:** Spec was missing `numClaps` query param. Adapter accepted it, but
the param-validator rejected unknown keys. Added `numClaps` (1–50, default 1) to
the operation parameters. Verified PASS via `verify medium --write --browser --ops clapArticle`.

**unsaveArticle:** BLOCKED — upstream API removed `removeFromPredefinedCatalog`.
Server now suggests `addToPredefinedCatalog`, but that mutation only accepts
`PredefinedCatalogAddOperationInput` with variants `{preprend, append}` (no
`remove` / `delete`). Probed candidate replacements:
`removeItemsFromCatalog`, `removeFromCatalog`, `removeFromReadingList`,
`unsavePost`, `removePredefinedCatalogItem`, `removeItemsFromPredefinedCatalog`,
`deletePredefinedCatalogItems`, `predefinedCatalogItem*`, etc. — none exist.
Introspection on `__type`/`__schema` is denied. To unblock: capture the live
"remove from reading list" GraphQL request via the medium.com UI (click the
remove menu item on a saved article) and replace `UNSAVE_ARTICLE_MUTATION` in
`adapters/queries.ts` accordingly.

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
