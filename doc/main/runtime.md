# Runtime Execution Pipeline

> Mode dispatch, parameter binding, redirect handling, and the full request lifecycle.
> Last updated: 2026-03-16 (commit: Tranche B)

## Overview

The runtime is the core of OpenWeb. Given a site name, operation ID, and parameters, it:
1. Loads the OpenAPI spec
2. Finds the operation
3. Resolves the execution mode
4. Dispatches to the correct executor
5. Returns a structured result

-> See: `src/runtime/executor.ts`

---

## Execution Dispatch

```
executeOperation(site, operationId, params, deps)
       │
       ├── Load OpenAPI spec (openapi.yaml)
       ├── Find operation by operationId
       ├── Resolve mode (operation → server → direct_http)
       │
       ├── L3 adapter?
       │     └── loadAdapter() → init() → isAuthenticated() → execute()
       │
       ├── extraction?
       │     └── executeExtraction()
       │
       ├── browser_fetch?
       │     └── executeBrowserFetch()
       │
       ├── session_http?
       │     └── executeSessionHttp()
       │
       └── direct_http?
             └── Direct fetch with SSRF validation
```

**Mode Resolution Hierarchy:**
1. Operation-level: `x-openweb.mode` on the operation
2. Server-level: `x-openweb.mode` on the server
3. Default: `direct_http`

If an operation has `x-openweb.adapter`, L3 adapter takes priority regardless of mode.
If an operation has `x-openweb.extraction`, the runtime dispatches to `executeExtraction()` before the HTTP executors.

---

## Parameter Binding

All HTTP executors share the same path/query/header/body binding pipeline.
`session_http` and `browser_fetch` layer auth/CSRF/signing on top; `direct_http` skips those browser-derived steps.

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

-> See: `src/runtime/session-executor.ts` — `resolveAllParameters()`, `substitutePath()`, `buildHeaderParams()`; `src/runtime/executor.ts` — direct HTTP reuse

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

Extraction operations reuse the same strict page matching as `session_http`: worker-like pages are filtered out, there is no unrelated-tab fallback, and missing tabs surface `needs_page` with an actionable URL hint.

-> See: `src/runtime/extraction-executor.ts`

---

## session_http Mode

The primary L2 execution mode. Uses a real HTTP client with cookies/headers extracted from the browser.

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
Worker-like pages (`*.js`, empty content) are ignored. There is no fallback to an unrelated tab. If no matching page is found, the runtime raises `needs_page` with a concrete URL to open.

-> See: `src/runtime/session-executor.ts`

---

## browser_fetch Mode

Same auth/CSRF/signing pipeline as session_http, but the final fetch runs inside the browser:

```typescript
page.evaluate(({ url, method, headers, body }) => {
  const resp = await fetch(url, { method, headers, body, credentials: 'include' });
  return { status, headers, body };
}, { url, method, headers, body });
```

**Key differences from session_http:**
- Browser handles cookies automatically via `credentials: 'include'` (no Cookie header injected)
- Native TLS fingerprint (not Node.js)
- CORS context preserved
- Only initial URL is SSRF-validated (browser handles redirects)

**When to use:** Sites that check TLS fingerprints, require CORS preflight, or need the browser's network stack (e.g., Discord).

-> See: `src/runtime/browser-fetch-executor.ts`

---

## direct_http Mode

Simplest mode — pure HTTP client, no browser.
It reuses the same path/query/header/body binding as `session_http`, but skips browser-derived auth/CSRF/signing.

```
fetch(url, { method, headers, body })
  │
  ├── SSRF validation on URL
  ├── Follow redirects (max 5)
  │     ├── SSRF validation per hop
  │     └── Strip sensitive headers on cross-origin
  └── Parse JSON response
```

-> See: `src/runtime/executor.ts` — `fetchWithValidatedRedirects()`

---

## Redirect Handling

All modes (except browser_fetch, which delegates to browser) follow redirects manually:

| Rule | Details |
|------|---------|
| Max redirects | Follow up to 5 redirects; fail if the 6th response is still a redirect |
| SSRF per hop | Each redirect URL validated against SSRF blocklist |
| Cross-origin | Strip `Authorization`, `Cookie`, `X-*` headers |
| 303 See Other | Rewrite method to GET, drop request body |
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

## Token Cache

Auth tokens can be cached to avoid re-extracting from browser on every request.

```typescript
class TokenCache {
  get(key): CachedAuth | undefined
  set(key, value, ttlMs): void
  invalidate(key): void
}
```

**Default TTL:** 5 minutes. Lazy expiry (checked on `get()`).

-> See: `src/runtime/token-cache.ts`

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
| `needs_browser` | Operation requires a browser but none connected | Launch Chrome with CDP |
| `needs_login` | User is not authenticated on the target site | Prompt user to log in |
| `needs_page` | No browser tab matches the target origin | Open the suggested site URL |
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
├── executor.ts               # Main dispatcher (mode routing, response handling)
├── session-executor.ts       # session_http mode (parameter binding, auth pipeline)
├── browser-fetch-executor.ts # browser_fetch mode (page.evaluate)
├── extraction-executor.ts    # extraction-only operations
├── adapter-executor.ts       # L3 adapter loading + execution
├── paginator.ts              # Pagination executor (cursor + link_header)
├── token-cache.ts            # Auth token cache with TTL
├── value-path.ts             # Shared dot-path helper for nested payloads
├── navigator.ts              # CLI navigation helper (render site/operation info)
└── primitives/               # L2 primitive resolvers
    └── (→ See: primitives.md)
```

---

## Related Docs

- [architecture.md](architecture.md) — System overview
- [primitives.md](primitives.md) — L2 primitive resolvers
- [adapters.md](adapters.md) — L3 adapter framework
- [security.md](security.md) — SSRF protection, redirect safety
- [meta-spec.md](meta-spec.md) — Type system driving execution
