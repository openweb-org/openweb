# x-openweb Extension Schema

OpenWeb extends OpenAPI 3.1 with `x-openweb` at two levels: **server-level**
(shared across all operations) and **operation-level** (per-operation overrides
and metadata).

Source of truth: `src/types/extensions.ts` and `src/types/primitives.ts`.

## Server-Level (`servers[0].x-openweb`)

Applied to the server object. Every field here affects ALL operations.

| Field | Type | Description |
|-------|------|-------------|
| `transport` | `node` \| `page` | **Required.** How the runtime executes HTTP requests. See Transport below. |
| `auth` | AuthPrimitive | Authentication strategy. Site-wide — applies to every operation. See `auth-patterns.md`. |
| `csrf` | CsrfPrimitive + `scope` | CSRF token resolution. `scope` lists HTTP methods that require CSRF (e.g., `[POST, PUT, DELETE]`). |
| `signing` | SigningPrimitive | Custom request signing (e.g., `sapisidhash` for YouTube). |

### Transport

- **`node`** — Runtime makes HTTP requests directly from Node.js. If auth is
  configured (e.g., `cookie_session`), the runtime extracts cookies/tokens from
  the browser **once** and caches them. The browser is not involved in each
  request. This is the fast path and should be the default unless bot detection
  prevents it.
- **`page`** — Runtime executes requests inside the browser tab via
  `page.evaluate(fetch(...))`. Required when bot detection (Akamai, PerimeterX,
  DataDome) blocks direct HTTP from Node.js. Slower but bypasses client-side
  checks.

**Mixed transport sites:** A site can use both `node` and `page` transport. Common pattern: reference data APIs (search filters, city lists, categories) work via node (no bot detection), while core data operations (search results, detail pages) need page adapter for DOM extraction. Set server-level transport to `page` and override individual node-friendly ops with per-operation `transport: node`.

### Auth

Auth is **site-level**. It applies to ALL operations — do not remove auth
because read operations happen to work without it. Write operations depend on
it. See `auth-patterns.md` for the full type catalog (cookie_session,
localStorage_jwt, exchange_chain, etc.).

### CSRF

| Type | How it works |
|------|-------------|
| `cookie_to_header` | Reads a cookie value and sends it as a request header. Fields: `cookie`, `header`. |
| `meta_tag` | Reads a `<meta>` tag from the page DOM. Fields: `name`, `header`. |
| `api_response` | Fetches a CSRF token from a dedicated endpoint. Fields: `endpoint`, `extract`, `inject`. |

The `scope` field (string array) controls which HTTP methods require the CSRF
token. Typically `["POST", "PUT", "DELETE"]` — GET requests usually skip CSRF.

### Signing

Currently one type: `sapisidhash` (YouTube/Google). Computes a hash from the
SAPISID cookie and origin, injected via the `inject` field.

## Operation-Level (per-operation `x-openweb`)

Applied to individual operations under `paths[].{method}.x-openweb`.

| Field | Type | Description |
|-------|------|-------------|
| `permission` | `read` \| `write` \| `delete` \| `transact` | Controls verify behavior and permission gates. GET = `read`, mutations = `write`/`delete`. |
| `build` | object | Compiler metadata: `stable_id`, `signature_id`, `tool_version`, `verified`, `signals`. **Do not edit** — managed by the compiler. |
| `transport` | `node` \| `page` | Override server-level transport for this operation. Rare — use only when one operation needs a different transport than the rest. |
| `csrf` | CsrfPrimitive + `scope` | Override server-level CSRF for this operation. |
| `pagination` | PaginationPrimitive | Cursor or link-header pagination config. |
| `extraction` | ExtractionPrimitive | SSR/DOM data extraction. See `extraction-patterns.md`. |
| `adapter` | AdapterRef | Delegates execution to a TypeScript adapter. The spec path becomes a logical namespace — the runtime does NOT use it for navigation. See below. |
| `actual_path` | string | Real URL path when the spec key is a virtual path (e.g., GraphQL dedup). |

### Permission

| Value | Verify behavior | Use for |
|-------|----------------|---------|
| `read` | Included in default `openweb verify` | GET, HEAD, GraphQL queries (even via POST) |
| `write` | Skipped unless `--write` flag | POST/PUT/PATCH mutations, GraphQL mutations |
| `delete` | Skipped unless `--write` flag | DELETE operations |
| `transact` | Always skipped | Financial transactions, irreversible actions |

### Pagination

| Type | Fields | Description |
|------|--------|-------------|
| `cursor` | `response_field`, `request_param`, `has_more_field?`, `items_path?` | Cursor-based: read cursor from response, pass as query param |
| `link_header` | `rel?` | HTTP Link header pagination (RFC 8288) |

### Extraction

| Type | Description |
|------|-------------|
| `ssr_next_data` | Extract from Next.js `__NEXT_DATA__` JSON. Fields: `page_url`, `path`. |
| `page_global_data` | Read a `window.*` global variable. Fields: `page_url`, `expression`, `path`. |
| `html_selector` | CSS selector on the DOM. Fields: `page_url`, `selectors`, `attribute`, `multiple`. |
| `script_json` | Parse `<script type="application/json">` blocks. Fields: `selector`, `path`. |

See `extraction-patterns.md` for decision flow and usage guidance.

### Adapter

When an operation has `x-openweb.adapter`, the runtime bypasses URL construction
entirely. It finds (or auto-opens) a page on the server origin, then calls
`adapter.execute(page, operationId, params)`. The adapter handles all navigation,
interaction, and data extraction.

**Key difference from all other transports:** the OpenAPI path is a logical
namespace, not a real URL. The runtime never navigates to `serverUrl + path`.
Multiple adapter operations can share the same real URL (differentiated by query
params or by which DOM region they extract). The adapter must use `params` to
navigate the page to the correct URL before extracting.

See `spec-curation.md` "Adapter Path Semantics" for path naming guidance.

## Complete YAML Example

```yaml
servers:
  - url: https://api.example.com
    x-openweb:
      transport: node
      auth:
        type: cookie_session
      csrf:
        type: cookie_to_header
        cookie: csrftoken
        header: X-CSRFToken
        scope: [POST, PUT, DELETE]

paths:
  /api/v1/feed/timeline:
    get:
      operationId: getTimeline
      summary: "Get home timeline — posts, reshares, author info, engagement counts"
      x-openweb:
        permission: read
        build:
          stable_id: example_getTimeline_v1
          tool_version: 2
        pagination:
          type: cursor
          response_field: next_cursor
          request_param: cursor

  /api/v1/posts/{postId}/like:
    post:
      operationId: likePost
      summary: "Like a post"
      x-openweb:
        permission: write
```

## Common Mistakes

1. **Removing site-level auth to make read-only verify pass.** Auth is
   site-level — it exists for write operations. Read ops may work without auth,
   but removing it breaks writes. Never remove auth just because `openweb verify`
   passes without it.

2. **Confusing `transport: node` + `auth: cookie_session` with "needs browser
   for each request."** With `node` transport, the runtime extracts cookies from
   the browser once and caches them. Users do not need to manually use the
   browser for each request. DOC.md should NOT say "write ops require a
   logged-in browser session" — it should say "cookies are extracted from the
   browser automatically."

3. **Setting write ops to `permission: read` to include them in verify.** This
   defeats the safety gate. Use `openweb verify <site> --write` to test write
   operations instead.

4. **Editing `build` fields.** These are compiler-managed metadata. Do not
   change `stable_id`, `tool_version`, or `verified` manually.

5. **Adapter ignoring params and not navigating.** When writing an adapter,
   every operation that needs a specific URL must use `params` to build it
   and call `page.goto()`. The runtime only opens the server origin — it does
   NOT navigate to the OpenAPI path. Writing `_params` (unused) is a bug.
