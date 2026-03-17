# L2 Primitive Resolvers

> Auth, CSRF, signing, pagination, and extraction primitives — the declarative layer that handles ~50% of websites.
> Last updated: 2026-03-17 (commit: M9)

## Overview

L2 primitives are **declarative config units** stored in the `x-openweb` extension of OpenAPI specs. The runtime reads them and resolves auth tokens, CSRF headers, request signatures, etc. — without any site-specific code.

Each primitive has a `type` discriminator and type-specific config fields.

-> See: `src/types/primitives.ts` — all 17 primitive type definitions

---

## Resolution Pipeline

On every L2 HTTP request (`node` or `page` transport), three resolvers run in sequence:

```
resolveAuth(handle, auth, serverUrl)     →  cookies + auth headers
resolveCsrf(handle, csrf, serverUrl)     →  CSRF headers (mutations only)
resolveSigning(handle, signing, serverUrl) →  signing headers (per-request)
```

All results are **merged into a single headers dict** passed to the HTTP request.

The `BrowserHandle` provides access to the Playwright `Page` and `BrowserContext` for browser-side extraction.

```typescript
interface BrowserHandle {
  page: Page
  context: BrowserContext
}

interface ResolvedInjections {
  headers: Record<string, string>
  cookieString?: string
}
```

-> See: `src/runtime/primitives/types.ts`

Extraction-only operations skip this auth/CSRF/signing pipeline and call the extraction resolvers directly through `executeExtraction()`.

---

## Auth Primitives

Auth primitives extract credentials from the browser and inject them into requests.

| Type | What it does | Browser API | Implemented |
|------|-------------|------------|-------------|
| `cookie_session` | Extract all cookies for the target URL | `context.cookies()` | Yes |
| `localStorage_jwt` | Read JWT from localStorage by key | `page.evaluate()` | Yes |
| `sessionStorage_msal` | Extract MSAL token from sessionStorage/localStorage | `page.evaluate()` | Yes |
| `page_global` | Evaluate JS expression on page (e.g., `window.ytcfg.get("ID_TOKEN")`) | `page.evaluate()` | Yes |
| `webpack_module_walk` | Walk webpack chunk cache, find module, call function | `page.evaluate()` | Yes |
| `exchange_chain` | Multi-step token exchange (call A → extract → call B → extract) | `fetch()` chain | Yes |
| `fallback` | Try primary auth, fall back to secondary on failure | (delegates) | No |

### cookie_session

The simplest auth. Extracts all cookies from the browser context matching the target URL.

```yaml
x-openweb:
  transport: node
  auth:
    type: cookie_session
```

No config needed — just reads `context.cookies(serverUrl)`.

-> See: `src/runtime/primitives/cookie-session.ts`

### localStorage_jwt

Reads a JWT stored in `localStorage`.

```yaml
auth:
  type: localStorage_jwt
  key: "BSKY_STORAGE"
  path: "session.currentAccount.accessJwt"
  inject: { header: "Authorization", prefix: "Bearer " }
```

- `key`: localStorage key
- `path`: dot-path to extract token from JSON value
- `inject`: where to place the token

-> See: `src/runtime/primitives/localstorage-jwt.ts`

### sessionStorage_msal

Reads an MSAL access token from browser storage and injects it into a header or query param.

```yaml
auth:
  type: sessionStorage_msal
  key_pattern: "msal.token.keys.*"
  scope_filter: "user.read"
  token_field: "secret"
  inject: { header: "Authorization", prefix: "Bearer " }
```

The resolver checks `sessionStorage` first, falls back to `localStorage`, filters by scope, and chooses the freshest unexpired token.

-> See: `src/runtime/primitives/sessionstorage-msal.ts`

### page_global

Evaluates a JS expression on the page and extracts a value.

```yaml
auth:
  type: page_global
  expression: "window.ytcfg.data_"
  inject: { header: "Authorization", prefix: "SAPISIDHASH " }
  values:
    - expression: "window.ytcfg.data_.DELEGATED_SESSION_ID"
      inject: { header: "X-Goog-PageId" }
```

Multiple values can be extracted from a single expression.

-> See: `src/runtime/primitives/page-global.ts`

### webpack_module_walk

Walks webpack chunk globals, finds a module matching a test, and calls a function.

```yaml
auth:
  type: webpack_module_walk
  chunk_global: "webpackChunkdiscord_app"
  module_test: "getToken"
  call: "getToken"
  inject: { header: "Authorization" }
```

Used by Discord — the auth token lives inside a webpack module.

-> See: `src/runtime/primitives/webpack-module-walk.ts`

### exchange_chain

Multi-step auth exchange. Each step calls an endpoint, extracts a value via dot-path, and feeds it to the next step.
The final extracted value can be injected into either a header or a query parameter.
If a step returns a manual 3xx redirect (for example to `/login`), the runtime classifies it as `needs_login` rather than `fatal`.

```yaml
auth:
  type: exchange_chain
  steps:
    - call: "https://api.example.com/auth/token"
      headers: { "Content-Type": "application/json" }
      body: { "grant_type": "session" }
      extract: "data.access_token"
  inject: { header: "Authorization", prefix: "Bearer " }
```

-> See: `src/runtime/primitives/exchange-chain.ts`

---

## CSRF Primitives

CSRF primitives extract anti-forgery tokens. Only resolved for **mutations** (POST, PUT, PATCH, DELETE).

| Type | What it does | Implemented |
|------|-------------|-------------|
| `cookie_to_header` | Read cookie value → set as header | Yes |
| `meta_tag` | Read `<meta>` tag content → set as header | Yes |
| `api_response` | Call CSRF endpoint, extract token → set as header | Yes |

### cookie_to_header

Classic CSRF pattern. Reads a cookie and injects it as a header.

```yaml
csrf:
  type: cookie_to_header
  cookie: "csrftoken"
  header: "X-CSRFToken"
```

-> See: `src/runtime/primitives/cookie-to-header.ts`

### meta_tag

Reads a `<meta>` element's `content` attribute from the DOM.

```yaml
csrf:
  type: meta_tag
  name: "csrf-token"
  header: "X-CSRF-Token"
```

Used by GitHub.

-> See: `src/runtime/primitives/meta-tag.ts`

### api_response

Calls a CSRF endpoint and extracts the token from the JSON response.

```yaml
csrf:
  type: api_response
  endpoint: "/api/csrf"
  method: GET
  extract: "token"
  inject: { header: "X-CSRF-Token" }
```

-> See: `src/runtime/primitives/api-response.ts`

---

## Signing Primitives

Signing primitives compute **per-request** signatures. Resolved on every request (not just mutations).

| Type | What it does | Implemented |
|------|-------------|-------------|
| `sapisidhash` | Compute YouTube-style SAPISIDHASH from cookie + origin + timestamp | Yes |

### sapisidhash

YouTube's proprietary request signing:

```yaml
signing:
  type: sapisidhash
  cookie: "SAPISID"
  origin: "https://www.youtube.com"
  inject: { header: "Authorization", prefix: "SAPISIDHASH " }
```

Computes: `SHA1(timestamp + " " + sapisidValue + " " + origin)` → `timestamp_hash`

-> See: `src/runtime/primitives/sapisidhash.ts`

---

## Pagination Primitives

Pagination is configured at the **operation** level in `x-openweb`.

| Type | Mechanism | Implemented |
|------|-----------|-------------|
| `cursor` | Response field → request param loop | Yes |
| `link_header` | Follow `Link: <url>; rel="next"` | Yes |

```yaml
x-openweb:
  pagination:
    type: cursor
    response_field: "cursor"
    request_param: "cursor"
    has_more_field: "has_more"
```

Both `response_field` and `has_more_field` support **dotted paths** for nested responses (e.g., `data.actor.entitySearch.results.nextCursor`).

`request_param` also supports dotted paths for writing the cursor into a nested request parameter. This is useful for GraphQL where the cursor must be injected into `variables.cursor` rather than a top-level param:

```yaml
pagination:
  type: cursor
  response_field: "data.actor.entitySearch.results.nextCursor"
  request_param: "variables.cursor"
```

-> See: `src/runtime/paginator.ts`, `src/runtime/value-path.ts`

---

## Extraction Primitives

Extraction primitives read data directly from the page DOM or SSR state — no API call needed.

| Type | What it does | Implemented |
|------|-------------|-------------|
| `script_json` | Extract JSON from `<script>` tags | Yes |
| `ssr_next_data` | Read `__NEXT_DATA__` | Yes |
| `html_selector` | CSS selector extraction | Yes |
| `page_global_data` | Read page global variable | Yes |

### script_json

Extracts structured data from `<script type="application/json">` or inline JSON.

```yaml
extraction:
  type: script_json
  selector: "script[data-target='react-app.embeddedData']"
  path: "payload.tree.items"
```

Used by GitHub for SSR-embedded data.

-> See: `src/runtime/primitives/script-json.ts`

### ssr_next_data

Reads structured data from Next.js pages via `window.__NEXT_DATA__` or the `#__NEXT_DATA__` script.

```yaml
extraction:
  type: ssr_next_data
  page_url: "/"
  path: "props.pageProps.bootstrapData.footer.data.contentLayout.modules"
```

Used by Walmart for homepage footer modules.

-> See: `src/runtime/primitives/ssr-next-data.ts`

### html_selector

Extracts DOM content by CSS selectors. Multiple selectors can be zipped into row objects.

```yaml
extraction:
  type: html_selector
  page_url: "/news"
  selectors:
    title: ".titleline > a"
    score: ".score"
    author: ".hnuser"
  multiple: true
```

Used by Hacker News for front-page story extraction.

-> See: `src/runtime/primitives/html-selector.ts`

### page_global_data

Evaluates a safe page-global expression and optionally follows a nested path into the returned object.

```yaml
extraction:
  type: page_global_data
  page_url: "/app"
  expression: "window.__STATE__"
  path: "viewer.profile.id"
```

This shares the same expression safety checks as `page_global` auth resolution.

-> See: `src/runtime/primitives/page-global-data.ts`

---

## Inject Schema

All primitives that inject values share the `Inject` interface:

```typescript
interface Inject {
  header?: string       // Set as HTTP header
  prefix?: string       // Prefix the value (e.g., "Bearer ")
  query?: string        // Set as query parameter
  json_body_path?: string   // Set in request body at JSON path
}
```

Most commonly: `{ header: "Authorization", prefix: "Bearer " }`

---

## File Structure

```
src/runtime/primitives/
├── types.ts                # BrowserHandle, ResolvedInjections
├── registry.ts             # Primitive resolver registry
├── index.ts                # Re-exports
├── cookie-session.ts       # cookie_session auth
├── cookie-to-header.ts     # cookie_to_header CSRF
├── localstorage-jwt.ts     # localStorage_jwt auth
├── page-global.ts          # page_global auth/CSRF
├── page-expression.ts      # shared safe expression evaluator
├── sessionstorage-msal.ts  # sessionStorage_msal auth
├── sapisidhash.ts          # SAPISIDHASH signing
├── meta-tag.ts             # meta_tag CSRF
├── api-response.ts         # api_response CSRF
├── exchange-chain.ts       # exchange_chain auth
├── script-json.ts          # script_json extraction
├── ssr-next-data.ts        # ssr_next_data extraction
├── html-selector.ts        # html_selector extraction
├── page-global-data.ts     # page_global_data extraction
├── webpack-module-walk.ts  # webpack_module_walk auth
└── primitives.test.ts      # Unit tests
```

---

## Related Docs

- [architecture.md](architecture.md) — System overview and 3-layer model
- [runtime.md](runtime.md) — Execution pipeline that invokes primitives
- [meta-spec.md](meta-spec.md) — Type definitions for all 17 primitives
- [adapters.md](adapters.md) — L3 escape hatch when primitives aren't enough
- `src/types/primitives.ts` — Full type definitions
