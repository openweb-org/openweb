# Twitch Pipeline Gaps

## Doc gaps

### No guidance for GQL persisted-query adapter sites in compile.md
**Problem:** compile.md describes the auto-compile → review → curate flow, but for GraphQL persisted-query sites, the auto-compile produces a single POST endpoint with no meaningful operation decomposition. The only useful path is adapter-only, but the doc doesn't call this out early.
**Root cause:** `compile.md` Step 2 Review mentions "SSR-heavy sites" as a trigger for adapter-only, but GQL persisted-query sites are a different pattern — they DO have JSON APIs, just behind a single multiplexed endpoint.
**Suggested fix:** Add a "GraphQL persisted-query sites" subsection to compile.md Step 2, noting that if all API samples hit a single `/graphql` POST endpoint with `extensions.persistedQuery`, skip further compile iterations and write an adapter directly. Reference `graphql-patterns.md`.

## Code gaps

### Compiler doesn't decompose GQL batched/persisted requests into sub-operations
**Problem:** The analyzer labels all `gql.twitch.tv/gql` POST requests as a single cluster (`/{param}` with 30 samples) because they share the same URL. The `operationName` in the request body is not used for sub-clustering.
**Root cause:** `src/compiler/analyzer/` — path normalization and clustering work on URL path, not request body. GraphQL sub-clustering (`graphql-cluster.ts`) may exist but didn't activate for these cross-domain GQL requests (requests go to `gql.twitch.tv` while capture was on `www.twitch.tv`).
**Suggested fix:** Ensure `graphql-cluster.ts` activates for any POST to a path ending in `/gql` or `/graphql`, even cross-domain. Use `operationName` from the request body as the sub-cluster key. This would produce meaningful operations like `searchResultsPage_SearchResults`, `channelRoot_AboutPanel`, etc. — still needing adapter wiring but with correct operation decomposition.

## Rules too tight

### Cross-domain GQL requests may be labeled off_domain
**Problem:** Twitch's GQL endpoint is on `gql.twitch.tv` while the capture was on `www.twitch.tv`. If the labeler treats `gql.twitch.tv` as off-domain, the GQL samples are excluded from analysis.
**Root cause:** Domain comparison in `labeler.ts` may not consider subdomains of the same registrable domain as same-domain.
**Suggested fix:** Use registrable domain (eTLD+1) comparison: `gql.twitch.tv` and `www.twitch.tv` both have registrable domain `twitch.tv` and should be treated as same-domain.
