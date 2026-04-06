# Runtime Execution Pipeline

> Transport dispatch, parameter binding, redirect handling, and the full request lifecycle.
> Last updated: 2026-04-06 (centralized warmSession, bot_blocked failureClass, auth cascade)

## Overview

The runtime is the core of OpenWeb. Given a site name, operation ID, and parameters, it:
1. Loads the OpenAPI spec and validates `x-openweb` extensions (AJV)
2. Finds the operation
3. **Permission gate** — checks `x-openweb.permission` (or derives from HTTP method) against `$OPENWEB_HOME/config.json`
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

**Operation timeout:** All operations are wrapped in a 30s timeout (configurable via `"timeout"` in `~/.openweb/config.json`, in milliseconds). The timer is properly cleaned up on completion to avoid resource leaks.

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
Defaults apply before binding, including body defaults. Body fields are validated against their declared schema types before request construction, and only fields declared in `requestBody` are serialized into the JSON body. Auth-injected query params (for example YouTube's `key`) are merged into the input map before URL construction; `buildTargetUrl()` deduplicates spec-declared params via a `seen` set and appends any remaining auth params via `extraQueryParams`, preventing double-append.
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

## Browser Lifecycle

The runtime auto-manages browser instances via `ensureBrowser()`. No manual `browser start` is needed.

```
ensureBrowser(cdpEndpoint?)
       │
       ├── External CDP endpoint provided?
       │     └── Connect directly (no managed browser involved)
       │
       ├── Managed browser already running? (PID file + process alive + CDP responds)
       │     └── Connect, touch last-used, ensure watchdog alive
       │
       └── No managed browser
             ├── Acquire filesystem lock (atomic, PID-based, stale-safe)
             ├── Double-check after lock (another process may have started Chrome)
             ├── Start headless Chrome (config from ~/.openweb/config.json)
             ├── Write PID/port files
             ├── Connect via CDP with retry
             ├── Touch last-used, spawn watchdog
             └── Return BrowserHandle { browser, release() }
```

**BrowserHandle:** Every caller gets a handle with `release()` that disconnects from CDP without killing Chrome. Chrome is killed only by `browser stop` or the idle watchdog.

**Shell watchdog:** A detached `sh` process polls `browser.last-used` every 60s. If Chrome has been idle for 5 minutes (no `exec` or `capture` activity), the watchdog kills Chrome, cleans up temp profile and state files, then exits. The watchdog is respawned on each `ensureBrowser()` call if not alive.

**Concurrency:** A filesystem lock (`browser.start.lock`) serializes Chrome startup across concurrent CLI processes. Stale locks (dead PID) are auto-cleaned.

-> See: `src/runtime/browser-lifecycle.ts`, `src/commands/browser.ts`

---

## Headless Stealth

The managed browser applies stealth measures to avoid bot detection:

1. **Patchright** — Playwright fork that patches CDP detection signals (`navigator.webdriver`, `Runtime.enable` leak, etc.). Drop-in API-compatible replacement.
2. **User-Agent override** — `--user-agent` flag sets a common Windows Chrome UA (Chrome/133) instead of the default headless UA string. Configurable via `user_agent` in `config.json`.
3. **Blink feature disable** — `--disable-blink-features=AutomationControlled` removes the `navigator.webdriver = true` flag.

These are applied automatically on managed browser startup. External CDP connections inherit whatever stealth the external browser has.

-> See: `src/runtime/browser-lifecycle.ts` (launch args), `src/lib/config.ts` (default UA)

---

## Session Warm-Up

`warmSession()` prepares a browser page for bot-protected sites by letting anti-bot sensor scripts (Akamai, DataDome, etc.) run and generate valid session cookies before the runtime issues API requests.

```
warmSession(page, url, opts?)
       │
       ├── Already warmed? (WeakSet cache per Page instance)
       │     └── No-op
       │
       ├── Navigate to URL (if not already on same origin)
       │     └── waitUntil: 'domcontentloaded' + 2s SPA settle
       │
       ├── waitForCookie specified?
       │     └── Poll context.cookies() until cookie appears (500ms interval)
       │
       └── No cookie specified
             └── Fixed 3s delay (sensor scripts typically complete in 1-2s)
```

Warm state is cached per `Page` — calling twice on the same page is a no-op. `warmSession()` is called centrally by `adapter-executor.ts` before every `adapter.execute()` call and by `browser-fetch-executor.ts` before every browser-fetch request. Adapters do not call `warmSession()` themselves.

-> See: `src/runtime/warm-session.ts`

---

## Auth Cascade (4-Tier)

For `node` transport operations that need auth (server has `x-openweb.auth`/`csrf`/`signing`), the runtime runs a 4-tier cascade:

```
Tier 1: Token cache       ─ Read cached cookies/localStorage
        hit? → execute with cached tokens
        401/403? → clear cache, fall to tier 2

Tier 2: Browser extract   ─ ensureBrowser() → extract fresh tokens
        success? → write cache, return result
        401/403? → fall to tier 3

Tier 3: Profile refresh   ─ Re-copy default Chrome profile (managed browser only)
        success? → write cache, return result
        401/403? → fall to tier 4

Tier 4: User login        ─ Open site in system browser, poll with exponential backoff
        Opens site_url from manifest (human login page, not API endpoint)
        Poll: refreshProfile() → retry → check auth (5s→10s→20s→40s→60s cap)
        Timeout: 5 minutes → throws needs_login
```

**External CDP:** When connecting to an external CDP endpoint (`--cdp-endpoint`), tiers 3 (profile refresh) is skipped since the runtime cannot restart an external browser. Tier 4 is only attempted if the endpoint is localhost.

**Lock strategy:** Token cache reads/writes use brief per-site locks. Browser operations (connecting, extracting, refreshing) are never held under the cache lock.

-> See: `src/runtime/http-executor.ts`, `src/runtime/browser-lifecycle.ts`, `src/runtime/cache-manager.ts`

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
Worker-like pages (`*.js`, empty content) are ignored. There is no fallback to an unrelated tab. If no matching page is found, the runtime attempts **auto-navigation**: it opens a new tab to the site's origin URL (with `load` wait + 2s SPA settle, 15s timeout) and re-checks. If navigation fails, the created page is cleaned up immediately. If auto-navigate also fails, the runtime raises `needs_page` with a concrete URL to open.

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
│     DISCONNECTED → CONNECTING → AUTHENTICATING      │
│     → READY → CLOSING → CLOSED                      │
│     (+ RECONNECTING for retry loops)                 │
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
| `opaqueredirect` | Browser-side behavior — `browser_fetch` with `redirect: 'manual'` returns opaque response (status 0). Not handled by Node-side redirect logic. |

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
| `needs_browser` | Operation requires a browser but none connected | Browser auto-starts; if it fails, run `openweb browser start` manually |
| `needs_login` | User is not authenticated on the target site | Run `openweb login <site>` then `openweb browser restart` |
| `needs_page` | No browser tab matches the target origin | Open the suggested site URL |
| `permission_denied` | Operation blocked by config | Update `permissions` in `$OPENWEB_HOME/config.json` |
| `permission_required` | Operation needs user approval (write/delete) | Ask user for confirmation |
| `retriable` | Transient failure (network, rate-limit) | Retry the request |
| `bot_blocked` | Bot detection triggered (CAPTCHA, challenge page) | `openweb browser restart --no-headless`, solve CAPTCHA, retry |
| `fatal` | Unrecoverable error (bad spec, unknown op) | Stop and report |

-> See: `src/lib/errors.ts`

HTTP-backed executors map statuses as follows: `401/403 -> needs_login`, `429/5xx -> retriable`, `400/404/405 -> fatal`.
`exchange_chain` uses `redirect: 'manual'`; a 3xx redirect from an exchange step is treated as `needs_login`, because valid exchange endpoints should not bounce to a login page.

The CLI catches errors and writes structured JSON to stderr.

---

## File Structure

```
src/runtime/
├── executor.ts               # Re-exports from http-executor (public API surface)
├── http-executor.ts          # Main dispatcher (transport routing, auth cascade, response handling)
├── executor-result.ts        # Unified ExecutorResult types (M36)
├── browser-lifecycle.ts      # Auto browser management (ensureBrowser, 4-tier auth cascade, watchdog)
├── warm-session.ts           # Anti-bot sensor warm-up (navigate + wait for session cookies)
├── request-builder.ts        # Shared request construction (path/query/header/body binding)
├── redirect.ts               # Redirect handling with SSRF validation
├── operation-context.ts      # Operation metadata resolution (transport, auth, extraction)
├── browser-fetch-executor.ts # Page transport (page.evaluate)
├── session-executor.ts      # Node authenticated transport (browser-derived auth/CSRF/signing)
├── node-ssr-executor.ts     # Node SSR execution
├── extraction-executor.ts    # Extraction-only operations
├── adapter-executor.ts       # L3 adapter loading + execution
├── http-retry.ts             # HTTP retry logic
├── page-polyfill.ts          # Browser page utilities
├── paginator.ts              # Pagination executor (cursor + link_header)
├── value-path.ts             # Shared dot-path helper for nested payloads
├── navigator.ts              # CLI navigation helper (render site/operation info)
├── cache-manager.ts          # Response cache
├── token-cache.ts            # AES-256-GCM encrypted vault (M34)
├── ws-executor.ts            # WebSocket operation execution (M35)
├── ws-connection.ts          # WS connection manager (7-state machine)
├── ws-router.ts              # WS message routing
├── ws-runtime.ts             # WS runtime lifecycle
├── ws-pool.ts                # WS connection pooling
├── ws-socket.ts              # WS socket abstraction
├── ws-cli-executor.ts        # WS CLI integration
├── page-candidates.ts        # Browser page matching for session executor
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
