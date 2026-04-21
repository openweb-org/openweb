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

All auth primitives use the shared `Inject` shape with `header`, `prefix`, or `query`. The `json_body_path` field on `Inject` is CSRF-only (used by the `api_response` CSRF primitive) and is not honored by auth resolvers.

To disable auth for a single operation, set `x-openweb.auth: false` at the operation level — this skips auth resolution for that op even when a server-level `auth` is configured. It does **not** disable CSRF or signing; opt those out separately with `csrf: false` / `signing: false` when needed.

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
  app_path: "/channels/@me"
  inject: { header: "Authorization" }
```

Used by Discord — the auth token lives inside a webpack module.

When `app_path` is set and the webpack cache is empty on the current page, the resolver auto-navigates to `{origin}{app_path}` to load the app bundle before retrying. This handles SPAs where the webpack bundle only loads on authenticated app pages, not the landing page.

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

## auth_check

Body-shape patterns that flag "unauthenticated despite HTTP 200" — some sites return 200 with an error envelope (e.g. `{"error": "login_required"}`) instead of a 401. `auth_check` lets the runtime synthesize a `needs_login` failure from the response body.

```yaml
x-openweb:
  auth_check:
    - path: "error.code"
      equals: "UNAUTHENTICATED"
    - path: "message"
      contains: "please log in"
    - equals: "unauthorized"   # matches a bare-string body
```

- Each rule needs either `equals` (strict, with string/number coercion) or `contains` (case-insensitive substring on the stringified value).
- Omit `path` to match against the body itself (useful for bare-string bodies).
- Rules combine with **OR** semantics — any match triggers `needs_login`.
- Can be set at server level (applies to all ops) or operation level. Operation-level `auth_check: false` disables a server-level rule for that op.

---

## Related Docs

- [README.md](README.md) — Primitive overview, taxonomy, and resolution pipeline
- [signing.md](signing.md) — CSRF, signing, and bot detection primitives
