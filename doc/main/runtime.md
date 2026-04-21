# Runtime Execution Pipeline

> Protocol routing, browser lifecycle, auth cascade, and request construction.
> Last updated: 2026-04-21 (647c20c)

## Entry Points

There are two public runtime entry points:

| Function | Role | Source |
|----------|------|--------|
| `dispatchOperation(site, operationId, params, deps)` | top-level protocol router used by CLI exec | `src/runtime/http-executor.ts` |
| `executeOperation(site, operationId, params, deps)` | HTTP operation executor | `src/runtime/http-executor.ts` |

`src/runtime/executor.ts` is only a barrel that re-exports both names.

## Protocol Dispatch

`dispatchOperation()` resolves the site package first, then routes by operation protocol:

```text
dispatchOperation()
  -> loadSitePackage(site)
  -> findOperationEntry(operationId)
  -> wrap fetchImpl with AbortController
  -> entry.protocol === 'http'
       ? withHttpRetry(() => executeOperation(...))
       : executeWsFromCli(...)
```

Important consequences:

- HTTP and WS use the same CLI surface.
- the operation timeout (`$OPENWEB_HOME/config.json -> timeout`, default `30000`) is enforced above the executor-specific code
- HTTP retries are applied around the HTTP path only

## HTTP Dispatch Order

Once the operation is known to be HTTP, `executeOperation()` takes over:

```text
executeOperation()
  -> optional quarantine warning from manifest
  -> loadOpenApi(site)
  -> find operation by operationId
  -> permission gate
  -> resolve transport (`node` or `page`)
  -> adapter branch?
  -> extraction branch?
  -> page transport?
  -> node transport
```

The short-circuit rules matter:

1. `x-openweb.adapter` wins first. If present, the runtime loads a `CustomRunner`.
2. `x-openweb.extraction` wins next. Extraction bypasses normal HTTP request execution.
3. Otherwise transport resolution applies: operation-level transport, then server-level transport, then default `node`.

WS is outside this stack. It is routed before `executeOperation()` based on the site package entry protocol, not on `x-openweb.transport`.

## Permission Gate

Every HTTP operation passes through the permission gate before any network work:

- explicit `x-openweb.permission` wins
- otherwise the runtime derives the category from method + path
- defaults come from `$OPENWEB_HOME/config.json`

Possible outcomes:

| Policy | Runtime result |
|--------|----------------|
| `allow` | continue |
| `prompt` | throw `permission_required` |
| `deny` | throw `permission_denied` |

Under `VITEST`, write/delete/transact operations are stopped earlier by the `TEST_BARRIER` to prevent real mutations during tests.

## Parameter Binding and Request Construction

All HTTP paths share the same parameter pipeline:

```text
validate params
  -> apply defaults
  -> resolve parameter templates (`x-openweb.template`)
  -> path substitution
  -> query/header collection
  -> request-body build
  -> auth/CSRF/signing augmentation
  -> wrap / GraphQL shaping
  -> execute request
  -> unwrap / response parse / optional schema validation
```

Key behaviors:

- `validateParams()` rejects unknown params and type mismatches
- parameter-level `x-openweb.template` derives wire values from other resolved params
- request bodies support both JSON and `application/x-www-form-urlencoded`
- `wrap`, `graphql_query`, and `graphql_hash` shape GraphQL/APQ requests
- `unwrap` extracts a dot-path from the parsed response before it is returned

Useful source files:

- `src/lib/param-validator.ts`
- `src/runtime/request-builder.ts`
- `src/lib/url-builder.ts`
- `src/runtime/response-unwrap.ts`

## Managed Browser Lifecycle

`ensureBrowser()` is the runtime-owned browser entry point.

```text
ensureBrowser(cdpEndpoint?)
  -> external endpoint? connect directly
  -> else check managed Chrome state files
  -> if missing, acquire browser.start.lock
  -> start managed Chrome if needed
  -> connect over CDP
  -> touch browser.last-used
  -> ensure watchdog is running
```

The browser model is split:

- **managed Chrome** is launched by `src/commands/browser.ts`
- **Patchright** is the CDP client used by `ensureBrowser()` and the capture layer

Managed-browser details:

- one managed instance per `OPENWEB_HOME`
- profile copy is blocklist-based: copy the whole Chrome profile except caches, runtime locks, session-restore files, and password stores
- a PID-file lock serializes concurrent startup
- a detached watchdog kills the browser after 5 minutes of idle time
- `BrowserHandle.release()` disconnects CDP; it does not kill Chrome

### Headless and User-Agent Behavior

- managed Chrome always gets `--disable-blink-features=AutomationControlled`
- `--user-agent=...` is only added when the user explicitly sets `userAgent` in config
- node-side requests still use `DEFAULT_USER_AGENT`, which is auto-detected from the local Chrome version when possible

This distinction matters: browser launch UA override is opt-in, while node transport always has a Chrome-like default UA.

## Page Acquisition and Warm-Up

Browser-backed operations use `PagePlan` plus `acquirePage()`:

```text
resolvePagePlan(server, operation)
  -> merge field-by-field
  -> interpolate entry_url with params
  -> reuse matching page if safe
  -> else navigate/create page
  -> apply ready selector / settle_ms
  -> optionally warm the page
```

The runtime uses a few important internal rules:

- `response_capture` forces a fresh page so the listener is installed before navigation
- extraction-only operations without an explicit `page_url` may use same-origin fallback instead of forcing literal-path navigation
- state-bound extractions (`script_json`, `ssr_next_data`, `page_global_data`) can refresh on reuse when a prefix-matched page is not exact enough
- `browser-fetch` can honor `page_plan.warm_origin`; adapter/extraction warm-up uses the resolved entry page directly

`warmSession()` itself handles:

- fixed delay when no cookie target is configured
- cookie-stabilization polling when a site needs a sensor cookie such as `_abck`
- bot-block retry loops for challenge pages
- optional `waitFor` predicates wired from `CustomRunner.warmReady()`

Relevant files:

- `src/runtime/page-plan.ts`
- `src/runtime/browser-fetch-executor.ts`
- `src/runtime/extraction-executor.ts`
- `src/runtime/warm-session.ts`

## Auth Cascade and Token Cache

Authenticated node transport uses a per-site token cache at:

```text
$OPENWEB_HOME/tokens/<site>/vault.json
```

The cascade is:

1. **token cache**: reuse cached cookies/storage when still valid
2. **live browser extraction**: resolve auth from the current browser state
3. **managed-profile refresh**: restart managed Chrome with a fresh profile copy
4. **user login loop**: open the site in the user's browser and poll with backoff

Notes:

- tier 3 only exists for the managed browser
- external CDP endpoints skip managed-profile refresh
- tier 4 only makes sense for localhost CDP endpoints
- cache locking is per site and short-lived; browser work is never held under the token lock

The login loop in the runtime (`handleLoginRequired`) opens the system browser. The CLI `openweb login <site>` command is different: it prefers the managed browser when one is already running.

## Transport-Specific Paths

### `node` transport

Use this when the API is stable enough to call from Node.js.

Two subpaths exist:

- **unauthenticated/direct**: build the request and call `fetchWithRedirects()`
- **authenticated**: resolve auth/CSRF/signing and use the session-style node executor path

Constant headers from `servers[].x-openweb.headers` are currently merged only on the unauthenticated/direct node path. They are not injected by the session executor or `page` transport.

### `page` transport

Use this when the request must run inside a real browser page:

- native TLS/browser fingerprint matters
- same-origin browser context matters
- in-page auth state or bot-mitigation state must stay attached to the page

The final request runs through `page.evaluate(fetch(...))`, not through the Node.js fetch path.

### Extraction

Extraction operations do not issue the declared HTTP request at all. They acquire a page and resolve one of the extraction primitives:

- `script_json`
- `ssr_next_data`
- `html_selector`
- `page_global_data`
- `response_capture`

`script_json` and `ssr_next_data` also have a node-side fast path when the data can be fetched and parsed directly from HTML.

### Adapter

Adapters run `CustomRunner.run(ctx)` after page acquisition, auth resolution, and warm-up. The runtime still owns:

- page acquisition
- auth resolution
- bot detection after the call
- page ownership cleanup

## Redirects and SSRF

- Node-side HTTP paths follow redirects manually with per-hop SSRF validation.
- Page transport validates the initial request URL, then delegates redirect behavior to the browser network stack.
- WS handshake validation converts `wss://` to `https://` for DNS/IP checks before connecting.

See [security.md](security.md) for the full model.

## Failure Classes

The CLI-facing error contract relies on `failureClass`, not just HTTP status:

| `failureClass` | Meaning |
|----------------|---------|
| `needs_browser` | a browser process or CDP connection is required |
| `needs_login` | auth is missing or expired and recovery did not succeed |
| `needs_page` | a matching page/tab is required |
| `bot_blocked` | challenge/CAPTCHA/rate-limit page detected |
| `permission_required` | action is prompt-gated |
| `permission_denied` | action is denied by policy |
| `retriable` | safe to retry after delay or recovery |
| `fatal` | fix the spec, params, or environment first |

## Relevant Files

```text
src/runtime/
├── executor.ts                # public exports only
├── http-executor.ts           # dispatchOperation + executeOperation
├── browser-lifecycle.ts       # ensureBrowser, watchdog, login loop
├── browser-fetch-executor.ts  # page transport
├── extraction-executor.ts     # extraction branch
├── node-ssr-executor.ts       # node-side HTML extraction
├── adapter-executor.ts        # CustomRunner loading + execution
├── request-builder.ts         # param -> wire shaping
├── response-unwrap.ts         # post-parse unwrapping
├── page-plan.ts               # page reuse / navigation / warm orchestration
├── cache-manager.ts           # auth-material capture/write
├── token-cache.ts             # encrypted per-site token vault
└── ws-*.ts                    # WebSocket runtime
```

## Related Docs

- [architecture.md](architecture.md)
- [meta-spec.md](meta-spec.md)
- [primitives/README.md](primitives/README.md)
- [security.md](security.md)

-> See: `src/runtime/http-executor.ts`

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

**Cross-origin cold-start retry:** Cross-origin `page.evaluate(fetch)` (e.g. `www.grubhub.com` → `api-gtm.grubhub.com`) can throw `TypeError: Failed to fetch` before bot-detection sensors have finished warming up. The executor catches this specific error, retries up to 2x (3 attempts total), and only then surfaces it as `retriable` `execution_failed`. Non-`TypeError` exceptions surface immediately.

**Custom-domain redirect rewrite:** When the entry page redirects to a different origin (publication custom-domain pattern: `*.substack.com → www.<pub>.com`, `*.shopify.com → custom domain`), an absolute-URL fetch back to the spec's encoded host is cross-origin from the redirected page → CORS rejects it as `TypeError: Failed to fetch`. The executor rewrites the request URL to `pageOrigin + pathname + search` only when `targetOrigin === entryOrigin`. Deliberate cross-origin API hosts (e.g. `amp-api.podcasts.apple.com` from `podcasts.apple.com`) are untouched.

**Iframe-isolated fetch:** The in-page fetch runs through a same-origin `about:blank` iframe to obtain an unwrapped `fetch` reference. Page scripts (DataDog RUM, Sentry, OneTrust) routinely monkey-patch `window.fetch` and the wrappers throw `TypeError: Failed to fetch` on absolute-URL + `credentials:'include'` calls. The iframe's window has a fresh fetch no page script has touched.

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
| Cross-origin | Strip `Authorization`, `Cookie`, and CSRF token headers (`x-csrftoken`, `x-csrf-token`) |
| 301 / 302 / 303 | Rewrite method to GET, drop request body (matches native `fetch` behavior) |
| 307 / 308 | Preserve original method and body |
| Missing `Location` | A 3xx without `Location` raises a retriable execution error |
| `opaqueredirect` | Browser-side behavior — `page` transport with `redirect: 'manual'` returns an opaque response (status 0). Not handled by Node-side redirect logic. |

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
├── extraction-executor.ts    # Extraction-only operations + post-extract bot detection
├── adapter-executor.ts       # L3 adapter loading + execution + post-exec bot detection
├── bot-detect.ts             # Shared page-level bot detection (PerimeterX, DataDome, Cloudflare)
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
