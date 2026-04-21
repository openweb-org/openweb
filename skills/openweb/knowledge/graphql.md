# GraphQL Patterns

Patterns for sites using GraphQL instead of (or alongside) REST. GraphQL introduces unique challenges for discovery, capture, and site package modeling.

## Persisted Queries

The client sends a hash instead of the full query string. The server looks up the query by hash.

- **Detection:** Request has `extensions.persistedQuery.sha256Hash` but no `query` field, or uses a short query param like `?hash=abc123`
- **Impact:** Cannot construct new queries -- only pre-registered hashes work. Site package must store the exact hash per operation.
- **Capture:** Record the hash + variables for each operation. The hash is the operation identity.
- **Modeling:** Store hash in `x-persisted-query-hash` extension in openapi.yaml.
- **Hash rotation:** Some sites rotate persisted query hashes on every deploy. For these, hardcoding hashes is fragile. Use an L3 adapter that extracts hashes at runtime from the site's JS bundle: `page.evaluate(() => fetch(mainBundleUrl).then(text => regex-parse queryId+operationName pairs))`.

### APQ Flavors (GET vs POST)

The runtime auto-selects the wire shape by HTTP method declared in the spec (`src/runtime/http-executor.ts:456-459`):

- **POST (Apollo)** — `buildJsonRequestBody` emits `extensions.persistedQuery.sha256Hash` in the JSON body, with user params wrapped under `variables` (`src/runtime/request-builder.ts:147-167`). If `graphql_query` is also set, the full query rides along as APQ cache-miss fallback.
- **GET (Relay)** — `buildGraphqlGetApqQuery` JSON-stringifies both `variables` and `extensions` (the `persistedQuery` envelope) and merges them into the URL query string (`src/runtime/request-builder.ts:182-216`):
  ```
  /path?variables={...}&extensions={"persistedQuery":{"version":1,"sha256Hash":"..."}}
  ```

Same spec declares both — the `requestBody` schema doubles as the variable payload for the GET flavor.

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

## GraphQL API Discovery

Five-step flow for discovering GraphQL operations on a target site.

### 1. CDP Capture

Record network traffic while browsing the site. Filter for GraphQL endpoints:

- **Path patterns:** `/graphql`, `/gql`, `/api/graphql`, `/graphql/{operationName}`
- **Request shape:** `POST` with `Content-Type: application/json` containing `operationName`, `query`, or `variables` fields
- **Batched requests:** Watch for JSON arrays — each element is a separate operation

Browse diverse site features (search, navigation, account pages) to surface as many operations as possible.

### 2. Introspection Attempt

Send the `__schema` introspection query against each discovered endpoint:

```graphql
{ __schema { types { name fields { name type { name kind ofType { name } } } } } }
```

- Many production sites disable introspection — expect rejection
- If it works, the full type graph is available; export and use it directly
- Try both authenticated and unauthenticated — some sites gate introspection behind auth

### 3. Error-Message Reversal

Send intentionally malformed queries. GraphQL servers often leak schema details in error responses:

- **Unknown field:** `Cannot query field "foo" on type "Query". Did you mean "fooBar", "fooBaz"?` — reveals valid field names
- **Type mismatch:** `Expected type "Int!", found "abc"` — reveals argument types
- **Missing required args:** `Field "search" argument "query" of type "String!" is required` — reveals required arguments

Iterate: use revealed names to construct progressively more complete queries.

### 4. Persisted Hash Extraction

Look for `sha256Hash` in `extensions.persistedQuery` within captured requests. Sites using APQ (Automatic Persisted Queries) embed operation hashes:

- Extract and catalog each hash alongside its `operationName` and `variables` shape
- Try sending a hash without a `query` field — if the server resolves it, the operation uses persisted queries
- Check the site's JS bundles for hash↔query mappings (some bundle the full query text alongside the hash)

### 5. Auth Test

Test each discovered operation with and without auth cookies to classify access requirements:

- **Public:** Returns data without cookies — model as unauthenticated
- **Authenticated:** Returns 401/403 or empty data without cookies — mark as requiring auth
- **Mixed:** Returns partial data without auth, full data with auth — note the difference in DOC.md

This classification drives `x-openweb.auth` settings in the site package.

## `graphql_query` Field-Conflict Escape Hatch

When `wrap: variables` is active and a user-facing param happens to be named `query` (common for search operations), the schema property would shadow the GraphQL query string at body root. The spec sets `x-openweb.graphql_query` to inject the GraphQL document at body root post-wrap, while the user's `query` param flows under `variables` (`src/types/extensions.ts:100-102`, `src/runtime/request-builder.ts:147-151`):

```yaml
x-openweb:
  wrap: variables
  graphql_query: "query SearchProducts($query: String!) { ... }"
```

Result on the wire: `{ query: "query SearchProducts...", variables: { query: "<user input>" } }`.

## Ephemeral queryId / doc_id Hashes

Some sites use ephemeral `doc_id` or `queryId` parameters instead of standard Apollo persisted-query hashes. Note: `queryId` here is extracted from URL **query params** (e.g. `?queryId=abc.1`) — this is distinct from Apollo persisted-query hashes carried in the POST body's `extensions.persistedQuery.sha256Hash` (`src/compiler/analyzer/graphql-cluster.ts:73-85`, where `queryId` discriminator is checked before `operationName`).

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

## Site Package Modeling

GraphQL operations are modeled as standard OpenAPI operations using virtual paths
and `actual_path` to multiplex onto a single `/graphql` endpoint:

```yaml
servers:
  - url: https://gql.example.com
    x-openweb:
      transport: node

paths:
  /gql~searchProducts:
    post:
      operationId: searchProducts
      x-openweb:
        permission: read
        actual_path: /gql
        wrap: variables           # user params go under variables
        unwrap: data              # extract data from response
      parameters:
        - name: Client-Id
          in: header
          required: true
          schema:
            type: string
            const: my-client-id   # fixed protocol header
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - query
              properties:
                query:
                  type: string
                  description: Search keyword
                limit:
                  type: integer
                  default: 20
                operationName:
                  type: string
                  const: SearchProducts
                extensions:
                  type: object
                  const:
                    persistedQuery:
                      version: 1
                      sha256Hash: "abc123..."
```

**Key patterns:**
- **Virtual path**: `/gql~searchProducts` is the spec key (unique per operation)
- **`actual_path: /gql`**: the real wire endpoint
- **`wrap: variables`**: non-const user-supplied params (`query`, `limit`) are wrapped under `variables` on the wire; fields with `schema.const` (`operationName`, `extensions`) stay at body root (`src/runtime/request-builder.ts:118-145`)
- **`unwrap: data`**: response `{ data: { ... }, errors: [] }` → extracts `data`
- **`schema.const`**: fixed headers (Client-Id) and body fields (operationName, hash) are invisible to callers
- **Path-differentiated GraphQL** (e.g. `/graphql/{operationName}`): use real paths, no `actual_path` needed

## Mutation Field Renames

Upstream GraphQL schemas churn — mutation fields get renamed, parameter shapes change, dedicated mutations get folded into generic ones (e.g., Medium's `removeFromPredefinedCatalog` → `editCatalogItems(operations: [{delete: {itemId}}])`).

- **Detection signals:** A previously-working mutation returns "field not found" or 400. Introspection is usually disabled.
- **Impact:** Site package looks "broken" but the underlying feature still works through a renamed operation.
- **Action:**
  1. Capture fresh HAR from the live UI clicking the same affordance.
  2. Search the captured GraphQL payload for the new mutation name.
  3. **Fragment names leak the new operation** — outgoing payloads include fragment identifiers like `editCatalogItemsMutation_postViewerEdge`, which name the new mutation even when the wire payload is otherwise opaque. This is the fastest discovery path when introspection is denied.
  4. If the new mutation requires a different ID shape (e.g. `catalogItemId` instead of `postId`), you may need an adapter pre-step (a read mutation/query that maps the old ID to the new one).

## Common Pitfalls

1. **Assuming one POST = one operation** -- check for batched queries
2. **Replaying persisted query hashes across deployments** -- hashes can change on redeploy. Verify regularly.
3. **Ignoring `operationName`** -- some sites use the same hash for multiple operations distinguished by `operationName`
4. **Missing fragments** -- queries may reference fragments defined elsewhere. Capture the full query text including fragments.
5. **CSRF on GraphQL** -- many GraphQL endpoints require a CSRF token even though they accept JSON. Check for `x-csrf-token` or similar headers.
