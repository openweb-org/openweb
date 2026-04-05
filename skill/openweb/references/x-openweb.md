# x-openweb Extension Schema

OpenWeb extends OpenAPI 3.1 with `x-openweb` at two levels: **server-level**
(shared across all operations) and **operation-level** (per-operation overrides).
WebSocket sites use AsyncAPI 3.0 with analogous extensions.

## Server-Level (`servers[0].x-openweb`)

Applied to the server object. Every field here affects ALL operations.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transport` | `node` \| `page` | Yes | How the runtime executes HTTP requests |
| `auth` | AuthPrimitive | No | Authentication strategy — site-wide, applies to every operation |
| `csrf` | CsrfPrimitive + `scope` | No | CSRF token resolution. `scope` lists methods requiring CSRF |
| `signing` | SigningPrimitive | No | Custom request signing |

### Transport

- **`node`** — HTTP from Node.js. Auth tokens extracted from browser once and
  cached. Fast path — default unless bot detection prevents it.
- **`page`** — Requests via `page.evaluate(fetch(...))` in browser tab. Required
  when bot detection blocks Node.js HTTP. Slower but bypasses client-side checks.

Mixed transport: set server-level to `page`, override node-friendly ops at
operation level.

### Auth Primitives

| Type | Key Fields |
|------|-----------|
| `cookie_session` | *(none — browser cookies forwarded as-is)* |
| `localStorage_jwt` | `key`, `path?`, `app_path?`, `inject` |
| `sessionStorage_msal` | `key_pattern`, `scope_filter?`, `token_field`, `inject` |
| `page_global` | `expression`, `inject`, `values?` |
| `webpack_module_walk` | `chunk_global`, `module_test`, `call`, `app_path?`, `inject` |
| `exchange_chain` | `steps[]`, `inject` |

`inject` places the resolved token: `header`, `prefix`, `query`, or `json_body_path`.

`app_path` (on `localStorage_jwt`, `webpack_module_walk`): absolute URL when the
token lives on a different domain than the API.

Auth is **site-level** — to disable for a public op, set `auth: false` at
operation level. Never remove site-wide auth.

See `knowledge/auth-primitives.md` for detailed config per type.

### CSRF Primitives

| Type | Fields | Description |
|------|--------|-------------|
| `cookie_to_header` | `cookie`, `header` | Reads cookie value, sends as header |
| `meta_tag` | `name`, `header` | Reads `<meta>` tag from page DOM |
| `api_response` | `endpoint`, `method?`, `extract`, `inject` | Fetches token from a dedicated endpoint |

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
| `pagination` | PaginationPrimitive | Cursor or link-header pagination config |
| `extraction` | ExtractionPrimitive | SSR/DOM data extraction config |
| `adapter` | AdapterRef | Delegates execution to a TypeScript adapter |
| `actual_path` | string | Real URL path when spec key is a virtual path (e.g. GraphQL dedup) |
| `build` | BuildMeta | Compiler metadata — **do not edit manually** |
| `safety` | `safe` \| `caution` | Compiler hint for state-modifying ops |
| `requires_auth` | boolean | Compiler hint — not enforced at runtime |

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
| `ssr_next_data` | `page_url?`, `path` | Extract from Next.js `__NEXT_DATA__` JSON |
| `page_global_data` | `page_url?`, `expression?`, `path?`, `adapter?`, `method?` | Read a `window.*` global variable |
| `html_selector` | `page_url?`, `selectors`, `attribute?`, `multiple?` | CSS selector on the DOM |
| `script_json` | `selector`, `path?` | Parse `<script type="application/json">` blocks |

See `knowledge/extraction.md` for decision flow and usage guidance.

### Adapter

Fields: `name` (required), `operation` (required), `params?`. When set, the
runtime bypasses URL construction — the OpenAPI path is a logical namespace.
The adapter must use `params` to navigate and extract data.

### Build Meta

Fields: `stable_id`, `signature_id`, `tool_version`, `verified`, `signals`.
**Compiler-managed — do not edit.**

## WebSocket Extensions (AsyncAPI)

WS sites use AsyncAPI 3.0 with `x-openweb` on server and operation objects.

### WS Server-Level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transport` | `node` \| `page` | Yes | Connection transport |
| `discriminator` | `{ sent, received }` | Yes | Message routing — field paths for sent/received messages |
| `auth` | WsAuthConfig | No | WS authentication strategy |
| `heartbeat` | WsHeartbeat | No | Keep-alive message config |
| `reconnect` | `{ max_retries, backoff_ms, resume_field? }` | No | Reconnection behavior |

**WS Auth types:** `ws_first_message`, `ws_upgrade_header`, `ws_url_token`, `ws_http_handshake`

### WS Operation-Level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `permission` | `read` \| `write` \| `delete` \| `transact` | Yes | Same as HTTP permission |
| `pattern` | `heartbeat` \| `request_reply` \| `subscribe` \| `publish` \| `stream` | Yes | Message exchange pattern |
| `subscribe_message` | WsMessageTemplate | No | Template for subscribe messages |
| `unsubscribe_message` | WsMessageTemplate | No | Template for unsubscribe messages |
| `correlation` | `{ field, source }` | No | Request-reply correlation. Source: `echo` \| `sequence` \| `uuid` |
| `event_match` | object | No | Discriminator values for matching inbound events |
| `build` | BuildMeta | No | Compiler metadata — do not edit |

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

1. **Removing site-level auth for verify.** Use `auth: false` per-operation instead.
2. **Setting write ops to `permission: read`.** Use `openweb verify --write` instead.
3. **Editing `build` fields.** Compiler-managed — do not touch.
4. **Adapter ignoring params.** The runtime only opens the server origin, not the spec path.
