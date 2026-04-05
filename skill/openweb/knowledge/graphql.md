# GraphQL Patterns

Patterns for sites using GraphQL instead of (or alongside) REST. GraphQL introduces unique challenges for discovery, capture, and site package modeling.

## Persisted Queries

The client sends a hash instead of the full query string. The server looks up the query by hash.

- **Detection:** Request has `extensions.persistedQuery.sha256Hash` but no `query` field, or uses a short query param like `?hash=abc123`
- **Impact:** Cannot construct new queries -- only pre-registered hashes work. Site package must store the exact hash per operation.
- **Capture:** Record the hash + variables for each operation. The hash is the operation identity.
- **Modeling:** Store hash in `x-persisted-query-hash` extension in openapi.yaml.
- **Hash rotation:** Some sites (e.g., X/Twitter) rotate persisted query hashes on every deploy. For these, hardcoding hashes is fragile. Use an L3 adapter that extracts hashes at runtime from the site's JS bundle: `page.evaluate(() => fetch(mainBundleUrl).then(text => regex-parse queryId+operationName pairs))`.

## Query Hashing (Client-Side)

The client includes the full query but also a computed hash for caching/validation.

- **Detection:** Request has both `query` and a hash field (`extensions.persistedQuery.sha256Hash`, `queryHash`, `documentId`)
- **Difference from persisted queries:** The full query is present -- you can read and modify it
- **Impact:** Mild -- the hash must match the query. If you modify the query, recompute the hash.
- **Capture:** Record both query and hash. Note the hashing algorithm (usually SHA-256 of the query string).

## Batched Queries

Multiple queries sent in a single HTTP request as a JSON array.

- **Detection:** Request body is an array `[{query, variables}, ...]`, response is an array of results
- **Impact:** Each query in the batch is a separate operation. During capture, split the batch into individual operations.
- **Capture:** Decompose batched requests. Map each array element to its own operation. Some operations only appear inside batches (page-load bundles).
- **Modeling:** Model each query as a separate operation. Note if the site expects batching (some reject individual queries).

## Introspection Disabled

The `__schema` / `__type` introspection queries are blocked.

- **Detection:** `{"errors":[{"message":"introspection is not allowed"}]}` or similar
- **Impact:** Cannot auto-discover the schema. Must infer types from captured responses.
- **Workaround:** Capture real traffic and build schema from observed request/response shapes. Some sites expose a schema file at a predictable path (`/graphql/schema.json`, `/api/schema.graphql`).
- **Capture:** Interact with as many features as possible to observe diverse queries and response shapes.

## Ephemeral queryId / doc_id Hashes

Some sites (notably Meta/Facebook, Instagram) use ephemeral `doc_id` or `queryId` parameters instead of standard Apollo persisted-query hashes.

**Key difference from Apollo persisted queries:**
- Apollo hashes are SHA-256 of the query text -- deterministic and reproducible
- `doc_id` / `queryId` values are server-assigned and change on every deploy
- No fallback to full query text -- the hash is the only way to call the operation

**Impact on site packages:**
- Operations break silently after site redeploys
- Verify reports `FAIL` with 400/500 or "query not found" errors
- Re-capture is the only fix -- you cannot compute new hashes

**Mitigation:**
- Document queryId-dependent operations in DOC.md Known Issues
- Set up regular verify cadence (weekly or on failure)
- Consider an adapter that extracts queryIds from the site's JS bundles at runtime (complex but durable)

## Differences from REST

| Aspect | REST | GraphQL |
|--------|------|---------|
| Endpoint | one URL per resource | single `/graphql` endpoint |
| Operation identity | HTTP method + path | `operationName` or query hash |
| Params | query string / body fields | `variables` object |
| Response shape | fixed per endpoint | varies per query |
| Permission mapping | method -> permission | must inspect query intent |
| Discovery | enumerate paths | enumerate `operationName` values from traffic |

### Permission Mapping

REST maps HTTP method to permission (GET->read, POST->write). GraphQL uses POST for everything. Map by operation intent:

- `query` operations -> `read`
- `mutation` operations -> `write` (or `delete`/`transact` based on intent)
- `subscription` operations -> `read` (stream)

## Common Pitfalls

1. **Assuming one POST = one operation** -- check for batched queries
2. **Replaying persisted query hashes across deployments** -- hashes can change on redeploy. Verify regularly.
3. **Ignoring `operationName`** -- some sites use the same hash for multiple operations distinguished by `operationName`
4. **Missing fragments** -- queries may reference fragments defined elsewhere. Capture the full query text including fragments.
5. **CSRF on GraphQL** -- many GraphQL endpoints require a CSRF token even though they accept JSON. Check for `x-csrf-token` or similar headers.
