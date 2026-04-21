# x-openweb Extension Schema

OpenWeb extends OpenAPI 3.1 with `x-openweb` at two levels: **server-level**
(shared across all operations) and **operation-level** (per-operation overrides).
WebSocket sites use AsyncAPI 3.0 with analogous extensions.

## Server-Level (`servers[0].x-openweb`)

Applied to the server object. Every field here affects ALL operations.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transport` | `node` \| `page` | Yes | How the runtime executes HTTP requests |
| `auth` | AuthPrimitive | No | Authentication — site-wide |
| `csrf` | CsrfPrimitive + `scope` | No | CSRF token resolution |
| `signing` | SigningPrimitive | No | Custom request signing |
| `auth_check` | AuthCheckPrimitive | No | Body-shape patterns that signal "unauthenticated despite HTTP 200" (e.g. empty `data` or specific error messages). Synthesizes a `needs_login` failure so the auth cascade can recover. Disable per-op with `auth_check: false` |
| `headers` | `Record<string, string>` | No | Constant headers merged into the direct/unauthenticated node path for this server (e.g. per-site User-Agent overrides). They are not currently injected by the session executor or `page` transport |
| `page_plan` | PagePlan | No | Default page-acquisition plan for page-transport operations (entry_url, ready, warm, nav_timeout) |
| `adapter` | AdapterRef | No | Default adapter for all operations under this server. Op-level `adapter` overrides; `adapter: false` opts out per-op |

### Transport

- **`node`** — HTTP from Node.js. Auth tokens extracted from browser once and
  cached. Fast path — default unless bot detection prevents it.
- **`page`** — Requests via `page.evaluate(fetch(...))` in browser tab. Required
  when bot detection blocks Node.js HTTP. Slower but bypasses client-side checks.

Mixed transport: set server-level to `page`, override node-friendly ops at operation level.

### Auth Primitives

| Type | Key Fields |
|------|-----------|
| `cookie_session` | *(none — browser cookies forwarded as-is)* |
| `localStorage_jwt` | `key`, `path?`, `app_path?`, `inject` |
| `sessionStorage_msal` | `key_pattern`, `scope_filter?`, `token_field`, `inject` |
| `page_global` | `expression`, `inject`, `values?` |
| `webpack_module_walk` | `chunk_global`, `module_test`, `call`, `app_path?`, `inject` |
| `exchange_chain` | `steps[]`, `inject` |

`inject` places the resolved token: `header`, `prefix`, or `query`. `json_body_path` is CSRF-only (`api_response`), not an auth inject target.
`app_path` (on `localStorage_jwt`, `webpack_module_walk`): absolute URL when
token lives on a different domain than the API.
Auth is **site-level** — disable per-op with `auth: false`. Never remove site-wide auth. `auth: false` only disables auth; use `csrf: false` / `signing: false` separately when a public op truly needs to bypass those too.

See `knowledge/auth-primitives.md` for detailed config per type.

### CSRF Primitives

| Type | Fields | Description |
|------|--------|-------------|
| `cookie_to_header` | `cookie`, `header` | Reads cookie value, sends as header |
| `meta_tag` | `name`, `header` | Reads `<meta>` tag from page DOM |
| `api_response` | `endpoint`, `method?`, `extract`, `inject` | Fetches token from a dedicated endpoint. `endpoint` must be an absolute HTTPS URL |

`scope` (string array): HTTP methods requiring CSRF, typically `["POST", "PUT", "DELETE"]`.

### Signing

| Type | Fields | Description |
|------|--------|-------------|
| `sapisidhash` | `cookie?`, `origin`, `inject` | Hash from SAPISID cookie + origin (YouTube/Google) |

## Operation-Level (per-operation `x-openweb`)

Applied to individual operations under `paths[].{method}.x-openweb`.

| Field | Type | Description |
|-------|------|-------------|
| `permission` | `read` \| `write` \| `delete` \| `transact` | Controls verify behavior and permission gates |
| `transport` | `node` \| `page` | Override server-level transport for this operation |
| `auth` | AuthPrimitive \| `false` | Override or disable server-level auth |
| `csrf` | CsrfPrimitive + `scope` \| `false` | Override or disable server-level CSRF |
| `signing` | SigningPrimitive \| `false` | Override or disable server-level signing |
| `auth_check` | AuthCheckPrimitive \| `false` | Override or disable server-level `auth_check` rules for this op |
| `pagination` | PaginationPrimitive | Cursor or link-header pagination config |
| `extraction` | ExtractionPrimitive | SSR/DOM data extraction config |
| `adapter` | AdapterRef \| `false` | Override or disable server-level adapter. `false` opts this op out of a server-level adapter |
| `actual_path` | string | Real URL path when spec key is a virtual path (e.g. GraphQL dedup) |
| `unwrap` | string | Dot-path into parsed response body to extract before returning (e.g. `data`, `0.data`) |
| `wrap` | string | Wrap non-const request body params under this key (e.g. `variables` for GraphQL) |
| `graphql_query` | string | GraphQL query string injected at body root when `wrap` is active and the schema property name would conflict with a user-facing param |
| `graphql_hash` | string | Persisted-query hash (e.g. `sha256:…`). On POST: body gets `extensions.persistedQuery.sha256Hash` (combined with `wrap: variables`). On GET: `variables` (from requestBody params) and `extensions` are JSON-stringified and URL-encoded into the query string — Relay-style APQ |
| `page_plan` | PagePlan | Runtime-owned navigation/readiness/warm (see [Page Plan](#page-plan-server-or-operation)) |
| `build` | BuildMeta | Compiler metadata — **do not edit manually** |
| `safety` | `safe` \| `caution` | Compiler hint for state-modifying ops |
| `requires_auth` | boolean | Compiler hint — not enforced at runtime |
| `verify_status` | `'ok'` \| `'requires_interactive_solve'` | When `requires_interactive_solve`, `verify` skips this op (CAPTCHA-gated, manual-solve required) |

### Permission

| Value | Verify behavior | Use for |
|-------|----------------|---------|
| `read` | Included in default `openweb verify` | GET, HEAD, GraphQL queries (even via POST) |
| `write` | Skipped unless `--write` flag | POST/PUT/PATCH mutations |
| `delete` | Skipped unless `--write` flag | DELETE operations |
| `transact` | Always skipped | Financial transactions, irreversible actions |

### Pagination

| Type | Fields | Description |
|------|--------|-------------|
| `cursor` | `response_field`, `request_param`, `has_more_field?`, `items_path?` | Cursor-based: read cursor from response, pass as query param |
| `link_header` | `rel?` | HTTP Link header pagination (RFC 8288) |

### Extraction

| Type | Fields | Description |
|------|--------|-------------|
| `ssr_next_data` | `page_url?`, `path`, `resolve_apollo_refs?`, `apollo_cache_path?` | Extract from Next.js `__NEXT_DATA__` JSON. Set `resolve_apollo_refs: true` to deep-walk `{ __ref: "TypeName:id" }` pointers against the Apollo cache (defaults to the extracted value; override with `apollo_cache_path`) |
| `page_global_data` | `page_url?`, `expression?`, `path?`, `adapter?`, `method?`, `resolve_apollo_refs?`, `apollo_cache_path?` | Read a `window.*` global variable. Same `resolve_apollo_refs` semantics as `ssr_next_data` |
| `html_selector` | `page_url?`, `selectors`, `attribute?`, `multiple?` | CSS selector on the DOM |
| `script_json` | `selector`, `path?`, `strip_comments?`, `type_filter?`, `multi?` | Parse `<script>` JSON blocks. `strip_comments: true` unwraps `<!-- -->`-wrapped JSON (Yelp-style). `type_filter` picks ld+json by `@type` (string or string[]); `multi: true` returns all matching blocks as array |
| `response_capture` | `match_url` (glob), `page_url?`, `unwrap?` | Navigate via PagePlan and capture the first network response matching `match_url`. Listener installed before `page.goto` — always forces fresh navigation |

See `knowledge/extraction.md` for decision flow and usage guidance.

### Page Plan (server or operation)

Runtime-owned page acquisition for browser-backed operations. Merges server-level defaults with operation-level overrides (field-by-field; explicit operation values win, including falsy).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `entry_url` | string | server URL | Where to navigate before executing. Supports caller-param interpolation; server URL variables are resolved separately on `serverUrl` |
| `ready` | string | — | CSS selector awaited after navigation |
| `wait_until` | string | `load` | Playwright `waitUntil` (`domcontentloaded` / `load` / `networkidle` / `commit`) |
| `settle_ms` | number | `0` | Extra delay after `ready` (escape hatch — prefer a tighter selector) |
| `warm` | boolean | `false` | Run `warmSession()` after readiness (PX / DataDome / Akamai) |
| `warm_origin` | `'page' \| 'server' \| URL` | auto | Override warm target. Default: entry_url origin when it differs from serverUrl, otherwise serverUrl. Use `'page'` when API is on a different subdomain from entry (e.g. apple-podcasts) |
| `nav_timeout_ms` | number | `30000` | Navigation + readiness timeout |

```yaml
servers:
  - url: https://www.example.com
    x-openweb:
      transport: page
      page_plan:
        ready: "#app"
        warm: true
paths:
  /search:
    get:
      x-openweb:
        page_plan:
          entry_url: /search
          ready: ".search-results"
```

PagePlan is ignored when transport is `node`. `response_capture` always uses fresh navigation (no page reuse).

### GraphQL

GraphQL is request-body shaping, not a separate transport. Use:
- `graphql_query` — inline query string; combined with `wrap: variables`
- `graphql_hash` — persisted-query hash. POST flavor: hash goes in body as `extensions.persistedQuery.sha256Hash` (Apollo APQ, with `wrap: variables`). GET flavor (Relay): `variables` + `extensions` are JSON-stringified then URL-encoded into the query string — no body sent. Runtime auto-selects by HTTP method.

Dynamic query-id scraping and per-response query-id schemes stay in a CustomRunner.

### Adapter (CustomRunner)

Fields: `name` (required), `operation` (required), `params?`. The runtime resolves PagePlan and optional auth **before** invoking the runner — a single `run(ctx: PreparedContext)` entry. No separate `init()` / `isAuthenticated()`. Opt out per operation with `adapter: false`.

Helpers injected on `ctx.helpers`: `pageFetch`, `graphqlFetch`, `ssrExtract`, `jsonLdExtract`, `domExtract`, `errors`.

`nodeFetch` and `interceptResponse` are helper-library utilities, not injected context members. Source adapters may import them directly from `../../../lib/adapter-helpers.js`; build bundles those imports into the emitted adapter `.js`.

### Response Unwrap

Extracts a sub-path from the parsed response before returning to the caller.
Uses `getValueAtPath()` which supports dot-paths and array indices.

- `unwrap: "data"` — standard GraphQL or REST envelope
- `unwrap: "0.data"` — batched GraphQL (array response)
- `unwrap: "data.searchFor"` — nested extraction

When `unwrap` is set and the response has a non-empty `errors` array with null/absent
unwrap target, the runtime throws `OpenWebError.apiError()` (GraphQL error detection).

### Request Wrap

Used with GraphQL to keep user-facing params flat while wrapping them into
`variables` on the wire. Non-const body params go under the `wrap` key;
`const`/`default` fields stay at root.

```yaml
x-openweb:
  wrap: variables
  graphql_query: "query SearchProducts($query: String!) { ... }"
  unwrap: data
```

`graphql_query` injects a literal query string at `body.query` — needed when
both the GraphQL query field and a user param are named `query`.

### Build Meta

`stable_id`, `signature_id`, `tool_version`, `verified`, `signals`.
**Compiler-managed — do not edit.**

## Parameter-Level (per-`parameter` `x-openweb`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `template` | string | No | Template literal with `{paramName}` placeholders. At request-build time, placeholders are substituted from resolved caller input. Templated params are derived — callers **cannot override**, and a referenced parameter missing from the resolved set raises `INVALID_PARAMS`. Example: `tags` with `template: "story,author_{id}"` → caller `{id: "pg"}` produces `tags=story,author_pg`. **Template-source params** (referenced as `{name}` by any sibling's `template` and not present in the API path) are automatically excluded from the outbound URL — they're derivation inputs, not wire params. |

## WebSocket Extensions (AsyncAPI)

WS sites use AsyncAPI 3.0 with `x-openweb` on server and operation objects.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transport` | `node` \| `page` | Yes | Connection transport |
| `discriminator` | `{ sent, received }` | Yes | Message routing field paths |
| `auth` | WsAuthConfig | No | WS auth strategy |
| `heartbeat` | WsHeartbeat | No | Keep-alive config |
| `reconnect` | `{ max_retries, backoff_ms, resume_field? }` | No | Reconnection config |

**WS Auth types:** `ws_first_message`, `ws_upgrade_header`, `ws_url_token`, `ws_http_handshake`

### WS Operation-Level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `permission` | `read` \| `write` \| `delete` \| `transact` | Yes | Same as HTTP |
| `pattern` | `heartbeat` \| `request_reply` \| `subscribe` \| `publish` \| `stream` | Yes | Exchange pattern |
| `subscribe_message` | WsMessageTemplate | No | Subscribe message template |
| `unsubscribe_message` | WsMessageTemplate | No | Unsubscribe message template |
| `correlation` | `{ field, source }` | No | Request-reply correlation (`echo` \| `sequence` \| `uuid`) |
| `event_match` | object | No | Discriminator values for inbound events |
| `build` | BuildMeta | No | Compiler metadata -- do not edit |

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
      x-openweb:
        permission: read
        pagination:
          type: cursor
          response_field: next_cursor
          request_param: cursor

  /api/v1/posts/{postId}/like:
    post:
      operationId: likePost
      x-openweb:
        permission: write

  /api/v1/status:
    get:
      operationId: getStatus
      x-openweb:
        permission: read
        auth: false     # disable server-level auth for public op
        csrf: false
```

## Pitfalls

1. **Removing site-level auth for verify.** Use `auth: false` per-operation instead. If the public op also must skip signing or CSRF, disable those separately.
2. **Setting write ops to `permission: read`.** Use `openweb verify --write` instead.
3. **Editing `build` fields.** Compiler-managed — do not touch.
4. **Adapter ignoring params.** The runtime only opens the server origin, not the spec path.
5. **DOC.md says "write ops require a logged-in browser session."** Wrong. With
   `node` + `cookie_session`, the runtime extracts cookies from the browser once
   and caches them. DOC.md should say "cookies are extracted from the browser
   automatically" — the user does not interact with the browser per request.
