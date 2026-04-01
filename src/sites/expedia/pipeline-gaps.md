## Pipeline Gaps — Expedia Discovery (2026-04-01)

### Doc gap: GraphQL APQ sites need adapter-first guidance

**Problem:** The compile pipeline produced 20 noise operations and 0 usable ones. The `/graphql` path was normalized to `/{param}`, and GraphQL sub-clustering by operationName didn't fire.

**Root cause:** `src/compiler/analyzer/path-normalize.ts` treats single-segment paths as parameterized. `/graphql` → `/{param}`. The GraphQL sub-clustering code (`graphql-cluster.ts`) requires the cluster to be recognized as GraphQL first, but the path normalization masks it.

**Suggested fix:** In path-normalize, exempt well-known fixed paths like `/graphql`, `/gql`, `/api/graphql` from parameterization. Or detect the `operationName` field in POST bodies during labeling to flag GraphQL before normalization.

### Code gap: APQ (persisted query) support missing from auto-curation

**Problem:** Expedia uses Automatic Persisted Queries — request bodies contain only `extensions.persistedQuery.sha256Hash` with no `query` field. The analyzer doesn't extract or model APQ hashes, so the generated spec can't replay them.

**Root cause:** `src/compiler/analyzer/graphql-cluster.ts` looks for `operationName` but doesn't extract APQ hashes or model them in the analysis output.

**Suggested fix:** During GraphQL sub-clustering, detect APQ pattern (`extensions.persistedQuery.sha256Hash` present, `query` absent) and store the hash per sub-cluster. The generator could emit these as operation-level metadata.

### Rules too loose: path normalization parameterizes fixed API paths

**Problem:** `/graphql` normalized to `/{param}` because only 1 unique value was seen at that segment position. This is correct for paths like `/users/123` vs `/users/456`, but wrong for well-known API endpoints.

**Root cause:** `path-normalize.ts` line ~90, the segment diversity check treats any segment seen only once as parameterizable.

**Suggested fix:** Maintain a denylist of well-known API path segments that should never be parameterized: `graphql`, `gql`, `api`, `v1`, `v2`, `v3`, `oauth`, `token`, `login`.

### Missing automation: no bot-detection signal → transport recommendation

**Problem:** Compile defaulted to `transport: node` even though Akamai cookies (`_abck`, `bm_*`, `ak_bmsc`) were present in the HAR. Verify then failed with 429s. Had to manually determine page transport was needed.

**Root cause:** The auth-candidates analyzer detects cookie patterns but doesn't flag bot-detection cookies. No pipeline stage recommends transport based on bot-detection signals.

**Suggested fix:** During analysis, check for known bot-detection cookie names (`_abck`, `bm_*`, `ak_bmsc`, `_px3`, `_pxhd`, `datadome`) and emit a `botDetection` signal in the analysis report. Auto-curation could use this to default to `page` transport.
