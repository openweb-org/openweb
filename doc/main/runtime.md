# Runtime Execution Pipeline

> Transport dispatch, parameter binding, redirect handling, and the full request lifecycle.
> Last updated: 2026-03-27 (ergo fixes: timeout, auto-navigate)

## Overview

The runtime is the core of OpenWeb. Given a site name, operation ID, and parameters, it:
1. Loads the OpenAPI spec and validates `x-openweb` extensions (AJV)
2. Finds the operation
3. **Permission gate** — checks `x-openweb.permission` (or derives from HTTP method) against `~/.openweb/permissions.yaml`
4. **Token cache check** — for authenticated node transport, tries cached cookies/storage before browser
5. Resolves the transport
6. Dispatches to the correct executor
7. Returns a structured result

-> See: `src/runtime/executor.ts`

---

## Execution Dispatch

```
executeOperation(site, operationId, params, deps)
       │
       ├── Check quarantine status (emit warning if quarantined)
       ├── Load OpenAPI spec (openapi.yaml)
       ├── Find operation by operationId
       ├── Permission gate (read/write/delete/transact → allow/prompt/deny)
       ├── Resolve transport (operation → server → node)
       │
       ├── L3 adapter?
       │     └── loadAdapter() → init() → isAuthenticated() → execute()
       │
       ├── extraction?
       │     └── executeExtraction()
       │
       ├── ws?
       │     └── ws-executor → ws-connection (7-state machine) → ws-router
       │
       ├── page?
       │     └── executeBrowserFetch()
       │
       └── node?
             ├── auth needed? → token cache hit? → executeCachedFetch()
             │                  cache miss      → executeSessionHttp() → write cache
             └── no auth → fetchWithRedirects()
```

**Transport Resolution Hierarchy:**
1. Operation-level: `x-openweb.transport` on the operation
2. Server-level: `x-openweb.transport` on the server
3. Default: `node`

If an operation has `x-openweb.adapter`, L3 adapter takes priority regardless of transport.
If an operation has `x-openweb.extraction`, the runtime dispatches to `executeExtraction()` before the HTTP executors.

**Operation timeout:** All operations are wrapped in a 30s timeout (configurable via `OPENWEB_TIMEOUT` env variable in milliseconds). The timer is properly cleaned up on completion to avoid resource leaks.

---

## Parameter Binding

All HTTP executors share the same path/query/header/body binding pipeline.
`node` transport with auth config layers auth/CSRF/signing on top; `node` without auth skips those browser-derived steps.

```
┌─────────────────────────────────────────────────────────┐
│  1. Validate      required checks, unknown rejection,   │
│                   type validation, apply defaults        │
│                                                         │
│  2. Path params   substitute {template} in URL path     │
│                                                         │
│  3. Query params  append to URL as ?key=value           │
│                                                         │
│  4. Header params set in request headers                │
│                                                         │
│  5. Body params   requestBody JSON fields → JSON body   │
│                   (POST/PUT/PATCH only)                 │
└─────────────────────────────────────────────────────────┘
```

Path/query/header parameters come from OpenAPI `parameters[]`.
Body parameters come from `requestBody.content['application/json'].schema.properties`.
Defaults apply before binding, including body defaults. Body fields are validated against their declared schema types before request construction, and only fields declared in `requestBody` are serialized into the JSON body. Auth-injected query params (for example YouTube's `key`) are merged before validation.
If an object `requestBody` is marked `required: true`, the runtime sends `{}` even when no explicit body fields are supplied, so the request still includes a JSON body.

-> See: `src/runtime/session-executor.ts`, `src/runtime/request-builder.ts` — `resolveAllParameters()`, `substitutePath()`, `buildHeaderParams()`; `src/runtime/executor.ts` — direct HTTP reuse

---

## Extraction Operations

Extraction-only operations read data from the live page instead of issuing an HTTP request.

```
┌─────────────────────────────────────────────────────┐
│  1. Connect to browser via CDP                      │
│  2. Find page matching page_url/origin              │
│  3. Resolve extraction primitive                    │
│     - script_json                                   │
│     - ssr_next_data                                 │
│     - html_selector                                 │
│     - page_global_data                              │
│  4. Return extracted JSON-ish payload               │
└─────────────────────────────────────────────────────┘
```

Extraction operations reuse the same strict page matching as node transport: worker-like pages are filtered out, there is no unrelated-tab fallback, and missing tabs surface `needs_page` with an actionable URL hint.

-> See: `src/runtime/extraction-executor.ts`

---

## Node Transport (Authenticated)

The primary L2 execution path. Uses a real HTTP client with cookies/headers extracted from the browser.

```
┌─────────────────────────────────────────────────────┐
│  1. Connect to browser via CDP                      │
│  2. Find page matching server origin                │
│     (filters worker-like pages, no unrelated-tab    │
│      fallback; exact origin → same host → same SLD) │
│  3. Validate parameters                             │
│  4. Build URL (path substitution + query params)    │
│  5. Resolve auth → cookies + headers                │
│  6. Resolve CSRF → headers (mutations only)         │
│  7. Resolve signing → headers (per-request)         │
│  8. Build request body (mutations only)             │
│  9. Execute HTTP request                            │
│ 10. Follow redirects (max 5, SSRF-validated)        │
│ 11. Parse + validate response                       │
└─────────────────────────────────────────────────────┘
```

**Page matching**: The runtime finds a real browser tab matching the API's origin.
Worker-like pages (`*.js`, empty content) are ignored. There is no fallback to an unrelated tab. If no matching page is found, the runtime attempts **auto-navigation**: it opens a new tab to the site's origin URL (with `networkidle` wait, 15s timeout) and re-checks. If auto-navigate also fails, the runtime raises `needs_page` with a concrete URL to open.

-> See: `src/runtime/session-executor.ts`, `src/runtime/redirect.ts`, `src/runtime/request-builder.ts`, `src/runtime/operation-context.ts`

---

## Page Transport

Same auth/CSRF/signing pipeline as node transport, but the final fetch runs inside the browser:

```typescript
page.evaluate(({ url, method, headers, body }) => {
  const resp = await fetch(url, { method, headers, body, credentials: 'include' });
  return { status, headers, body };
}, { url, method, headers, body });
```

**Key differences from node transport:**
- Browser handles cookies automatically via `credentials: 'include'` (no Cookie header injected)
- Native TLS fingerprint (not Node.js)
- CORS context preserved
- Only initial URL is SSRF-validated (browser handles redirects)

**When to use:** Sites that check TLS fingerprints, require CORS preflight, or need the browser's network stack (e.g., Discord).

-> See: `src/runtime/browser-fetch-executor.ts`

---

## Node Transport (Public)

Simplest path — pure HTTP client, no browser.
It reuses the same path/query/header/body binding as authenticated node transport, but skips browser-derived auth/CSRF/signing.

```
fetch(url, { method, headers, body })
  │
  ├── SSRF validation on URL
  ├── Follow redirects (max 5)
  │     ├── SSRF validation per hop
  │     └── Strip sensitive headers on cross-origin
  └── Parse JSON response
```

-> See: `src/runtime/redirect.ts` — `fetchWithRedirects()`

---

## WebSocket Transport (M35)

For sites with AsyncAPI specs (real-time channels), the WS executor manages persistent connections:

```
┌─────────────────────────────────────────────────────┐
│  1. Load AsyncAPI spec (asyncapi.yaml)              │
│  2. Find channel by operationId                     │
│  3. Connect via ws-connection (7-state machine)     │
│     idle → connecting → connected → subscribing     │
│     → active → draining → closed                    │
│  4. Route messages via ws-router (pattern matching)  │
│  5. Return structured result                        │
└─────────────────────────────────────────────────────┘
```

Connection pooling reuses connections across operations on the same server. Auth primitives (ws_url_token, ws_first_message) inject credentials into the WebSocket handshake or initial message.

-> See: `src/runtime/ws-executor.ts`, `src/runtime/ws-connection.ts`, `src/runtime/ws-router.ts`

---

## Redirect Handling

All transports (except page, which delegates to browser) follow redirects manually:

| Rule | Details |
|------|---------|
| Max redirects | Follow up to 5 redirects; fail if the 6th response is still a redirect |
| SSRF per hop | Each redirect URL validated against SSRF blocklist |
| Cross-origin | Strip `Authorization`, `Cookie`, `X-CSRF-*` headers |
| 301 / 302 / 303 | Rewrite method to GET, drop request body (matches native `fetch` behavior) |
| 307 / 308 | Preserve original method and body |
| Missing `Location` | A 3xx without `Location` raises a retriable execution error |
| `opaqueredirect` | Respected — stops redirect chain, returns as-is |

-> See: [security.md](security.md) — SSRF protection details

---

## Response Handling

```
HTTP Response
  │
  ├── Parse JSON body (or return raw text for non-JSON)
  ├── Validate against response schema (if defined in OpenAPI spec)
  │     └── AJV validation, result in responseSchemaValid field
  └── Return ExecuteResult { status, body, responseSchemaValid, responseHeaders }
```

---

## Pagination

Two pagination modes are implemented:

| Mode | Mechanism | Config |
|------|-----------|--------|
| `cursor` | Extract cursor from response → inject into next request | `response_field`, `request_param`, `has_more_field` |
| `link_header` | Follow `Link: <url>; rel="next"` header | `rel` (default: "next") |

**Safety:** Max 10 pages by default (configurable).
Cursor pagination accepts dot-paths for both reading and writing:
- `response_field` and `has_more_field` support nested extraction (e.g., `data.actor.entitySearch.results.nextCursor`)
- `request_param` supports nested injection (e.g., `variables.cursor` for GraphQL), using `setValueAtPath()` to write the cursor into a nested request body object

-> See: `src/runtime/paginator.ts`, `src/runtime/value-path.ts`

---

## Error Model

All runtime errors are wrapped in `OpenWebError`:

```typescript
interface OpenWebErrorPayload {
  error: 'execution_failed' | 'auth'
  code: 'EXECUTION_FAILED' | 'TOOL_NOT_FOUND' | 'INVALID_PARAMS' | 'AUTH_FAILED'
  message: string
  action: string
  retriable: boolean
  failureClass: FailureClass
}
```

### Failure Classification (M5)

Every error carries a `failureClass` that tells the agent what to do next:

| Class | Meaning | Agent action |
|-------|---------|-------------|
| `needs_browser` | Operation requires a browser but none connected | Run `openweb browser start` |
| `needs_login` | User is not authenticated on the target site | Run `openweb login <site>` then `openweb browser restart` |
| `needs_page` | No browser tab matches the target origin | Open the suggested site URL |
| `permission_denied` | Operation blocked by permissions.yaml | Update `~/.openweb/permissions.yaml` |
| `permission_required` | Operation needs user approval (write/delete) | Ask user for confirmation |
| `retriable` | Transient failure (network, rate-limit) | Retry the request |
| `fatal` | Unrecoverable error (bad spec, unknown op) | Stop and report |

-> See: `src/lib/errors.ts`

HTTP-backed executors map statuses as follows: `401/403 -> needs_login`, `429/5xx -> retriable`, `400/404/405 -> fatal`.
`exchange_chain` uses `redirect: 'manual'`; a 3xx redirect from an exchange step is treated as `needs_login`, because valid exchange endpoints should not bounce to a login page.

The CLI catches errors and writes structured JSON to stderr.

---

## File Structure

```
src/runtime/
├── executor.ts               # Main dispatcher (transport routing, response handling)
├── http-executor.ts          # HTTP execution (direct + session, split from executor M36)
├── executor-result.ts        # Unified ExecutorResult types (M36)
├── request-builder.ts        # Shared request construction (path/query/header/body binding)
├── redirect.ts               # Redirect handling with SSRF validation
├── operation-context.ts      # Operation metadata resolution (transport, auth, extraction)
├── browser-fetch-executor.ts # Page transport (page.evaluate)
├── node-ssr-executor.ts      # Node SSR execution
├── extraction-executor.ts    # Extraction-only operations
├── adapter-executor.ts       # L3 adapter loading + execution
├── paginator.ts              # Pagination executor (cursor + link_header)
├── value-path.ts             # Shared dot-path helper for nested payloads
├── navigator.ts              # CLI navigation helper (render site/operation info)
├── cache-manager.ts          # Response cache
├── token-cache.ts            # AES-256-GCM encrypted vault (M34)
├── test-runner.ts            # verify command implementation
├── ws-executor.ts            # WebSocket operation execution (M35)
├── ws-connection.ts          # WS connection manager (7-state machine)
├── ws-router.ts              # WS message routing
├── ws-runtime.ts             # WS runtime lifecycle
├── ws-pool.ts                # WS connection pooling
└── primitives/               # L2 primitive resolvers
    ├── registry.ts           # Primitive type registry
    ├── index.ts              # Primitive pipeline orchestration
    └── (→ See: primitives/README.md)
```

---

## Related Docs

- [architecture.md](architecture.md) — System overview
- [primitives/](primitives/README.md) — L2 primitive resolvers
- [adapters.md](adapters.md) — L3 adapter framework
- [security.md](security.md) — SSRF protection, redirect safety
- [meta-spec.md](meta-spec.md) — Type system driving execution
