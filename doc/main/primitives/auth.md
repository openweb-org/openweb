# Auth Primitives

> Auth primitives extract credentials from the browser and inject them into requests.

| Type | What it does | Browser API | Implemented |
|------|-------------|------------|-------------|
| `cookie_session` | Extract all cookies for the target URL | `context.cookies()` | Yes |
| `localStorage_jwt` | Read JWT from localStorage by key | `page.evaluate()` | Yes |
| `sessionStorage_msal` | Extract MSAL token from sessionStorage/localStorage | `page.evaluate()` | Yes |
| `page_global` | Evaluate JS expression on page (e.g., `window.ytcfg.get("ID_TOKEN")`) | `page.evaluate()` | Yes |
| `webpack_module_walk` | Walk webpack chunk cache, find module, call function | `page.evaluate()` | Yes |
| `exchange_chain` | Multi-step token exchange (call A -> extract -> call B -> extract) | `fetch()` chain | Yes |
| `fallback` | Ordered auth strategy list (TS type only — not in JSON schema) | — | No |

---

## cookie_session

The simplest auth. Extracts all cookies from the browser context matching the target URL.

```yaml
x-openweb:
  transport: node
  auth:
    type: cookie_session
```

No config needed — just reads `context.cookies(serverUrl)`.

-> See: `src/runtime/primitives/cookie-session.ts`

---

## localStorage_jwt

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

---

## sessionStorage_msal

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

---

## page_global

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

---

## webpack_module_walk

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

---

## exchange_chain

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

## Related Docs

- [README.md](README.md) — Primitive overview, taxonomy, and resolution pipeline
- [signing.md](signing.md) — CSRF, signing, and bot detection primitives
