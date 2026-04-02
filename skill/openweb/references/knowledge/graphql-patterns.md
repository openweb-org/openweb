# GraphQL Patterns

Patterns for sites that use GraphQL instead of (or alongside) REST. GraphQL introduces unique challenges for discovery, capture, and site package modeling.

## Persisted Queries

The client sends a hash instead of the full query string. The server looks up the query by hash.

- **Detection signals:** request has `extensions.persistedQuery.sha256Hash` but no `query` field, or uses a short query param like `?hash=abc123`
- **Example (Apollo-style):**
  ```json
  {
    "operationName": "SearchProducts",
    "variables": {"query": "shoes", "limit": 20},
    "extensions": {"persistedQuery": {"version": 1, "sha256Hash": "abc123def456..."}}
  }
  ```
- **Impact:** cannot construct new queries — only the pre-registered hashes work. site package must store the exact hash per operation.
- **Capture strategy:** record the hash + variables for each operation. The hash is the operation identity.
- **site package modeling:** store hash in `x-persisted-query-hash` extension in openapi.yaml.

## Query Hashing (Client-Side)

The client includes the full query but also a computed hash for caching/validation.

- **Detection signals:** request has both `query` and a hash field (`extensions.persistedQuery.sha256Hash`, `queryHash`, `documentId`)
- **Difference from persisted queries:** the full query is present — you can read and modify it
- **Impact:** mild — the hash must match the query. If you modify the query, recompute the hash.
- **Capture strategy:** record both query and hash. Note the hashing algorithm (usually SHA-256 of the query string).

## Batched Queries

Multiple queries sent in a single HTTP request as a JSON array.

- **Detection signals:** request body is an array `[{query, variables}, {query, variables}, ...]`, response is an array of results
- **Example:**
  ```json
  [
    {"operationName": "GetUser", "variables": {"id": "123"}, "query": "query GetUser($id: ID!) {...}"},
    {"operationName": "GetCart", "variables": {}, "query": "query GetCart {...}"}
  ]
  ```
- **Impact:** each query in the batch is a separate operation. During capture, split the batch into individual operations.
- **Capture strategy:** decompose batched requests. Map each array element to its own operation. Note that some operations only appear inside batches (page-load bundles).
- **site package modeling:** model each query as a separate operation. Add a note if the site expects batching (some reject individual queries).

## Introspection Disabled

The `__schema` / `__type` introspection queries are blocked.

- **Detection signals:** `{"errors":[{"message":"introspection is not allowed"}]}` or similar
- **Impact:** cannot auto-discover the schema. Must infer types from captured responses.
- **Workaround:** capture real traffic and build the schema from observed request/response shapes. Some sites expose a schema file at a predictable path (`/graphql/schema.json`, `/api/schema.graphql`).
- **Capture strategy:** interact with as many features as possible to observe diverse queries and response shapes.

## Differences from REST

| Aspect | REST | GraphQL |
|--------|------|---------|
| Endpoint | one URL per resource | single `/graphql` endpoint |
| Operation identity | HTTP method + path | `operationName` or query hash |
| Params | query string / body fields | `variables` object |
| Response shape | fixed per endpoint | varies per query |
| Permission mapping | method → permission | must inspect query intent |
| Discovery | enumerate paths | enumerate `operationName` values from traffic |

### Permission Mapping

REST maps HTTP method to permission (GET→read, POST→write). GraphQL uses POST for everything. Map permission by operation intent:

- `query` operations → `read`
- `mutation` operations → `write` (or `delete`/`transact` based on intent)
- `subscription` operations → `read` (stream)

## site package Modeling

GraphQL operations map to openapi.yaml with a single path and operation-level discrimination:

```yaml
/graphql:
  post:
    x-graphql: true
    x-operations:
      - operationId: searchProducts
        operationName: SearchProducts
        type: query
        persistedQueryHash: "abc123..."  # if persisted
        variables:
          query: { type: string, required: true }
          limit: { type: integer }
        permission: read
      - operationId: addToCart
        operationName: AddToCart
        type: mutation
        variables:
          productId: { type: string, required: true }
          quantity: { type: integer }
        permission: write
```

## Common Pitfalls

1. **Assuming one POST = one operation** — check for batched queries
2. **Replaying persisted query hashes across deployments** — hashes can change on redeploy. Verify regularly.
3. **Ignoring `operationName`** — some sites use the same hash for multiple operations distinguished by `operationName`
4. **Missing fragments** — queries may reference fragments defined elsewhere. Capture the full query text including fragments.
5. **CSRF on GraphQL** — many GraphQL endpoints require a CSRF token even though they accept JSON. Check for `x-csrf-token` or similar headers.

## Ephemeral queryId / doc_id Hashes

Some sites (notably Meta/Facebook, Instagram) use ephemeral `doc_id` or `queryId`
parameters instead of the standard Apollo persisted-query mechanism. These are
opaque numeric IDs that map to server-side query definitions.

**Key difference from Apollo persisted queries:**
- Apollo hashes are SHA-256 of the query text — deterministic and reproducible
- `doc_id` / `queryId` values are server-assigned and change on every deploy
- There is no fallback to full query text — the hash is the only way to call the operation

**Impact on site packages:**
- Operations using ephemeral queryIds break silently after site redeploys
- Verify will report `FAIL` with 400/500 status or "query not found" errors
- Re-capture is the only fix — you cannot compute new hashes

**Mitigation:**
- Document queryId-dependent operations in DOC.md Known Issues
- Set up regular verify cadence for these sites (weekly or on failure)
- When re-capturing, record the same operations to get updated hashes
- Consider writing an adapter that extracts queryIds from the site's JavaScript
  bundles at runtime (complex but more durable)

## Related References

- `references/compile.md` — compile review for GraphQL operations
- `references/discover.md` — identifying GraphQL during capture inspection
- `references/knowledge/auth-patterns.md` — CSRF detection for GraphQL endpoints
