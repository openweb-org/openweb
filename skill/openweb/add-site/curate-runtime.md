# Curate: Runtime Configuration

Auth, transport, extraction, and adapter configuration in `openapi.yaml`. Load
during curation when the site needs auth, bot detection workarounds, SSR
extraction, or adapter-based operations.

> Full x-openweb field schema: `references/x-openweb.md`

## x-openweb Quick Reference

**Server-level** (`servers[0].x-openweb`) — applies to all operations:

| Field | Type | Required |
|-------|------|----------|
| `transport` | `node` \| `page` | Yes |
| `auth` | AuthPrimitive | If site has auth |
| `csrf` | CsrfPrimitive + `scope` | If site has CSRF |
| `signing` | SigningPrimitive | If site has signing |

**Operation-level** (per-operation `x-openweb`) — overrides server config:

| Field | Type |
|-------|------|
| `transport` | `node` \| `page` — override server transport |
| `auth` | AuthPrimitive \| `false` — override or disable |
| `csrf` | CsrfPrimitive \| `false` — override or disable |
| `signing` | SigningPrimitive \| `false` — override or disable |
| `extraction` | ExtractionPrimitive — SSR/DOM extraction |
| `adapter` | AdapterRef — delegates to TypeScript adapter |
| `pagination` | PaginationPrimitive — cursor or link-header |
| `build` | object — compiler metadata, **do not edit** |

---

## Transport Selection

```
Does the endpoint return JSON directly (XHR/fetch)?
  ├─ Yes → Does node work (no bot detection)?
  │     ├─ Yes → node (fastest)
  │     └─ No → page (browser-fetch)
  └─ No → Is data in SSR HTML?
       ├─ Yes, simple (single expression) → extraction
       └─ No, or complex → adapter
```

- **`node`** — Direct HTTP from Node.js. Auth tokens extracted from browser once,
  cached. Fast path — default unless bot detection blocks it.
- **`page`** — Executes `fetch()` inside the browser tab. Required when Akamai,
  PerimeterX, or DataDome block direct HTTP. Slower but bypasses client-side checks.
- **Mixed sites:** Set server-level to `page`, override node-friendly ops per-operation:

```yaml
servers:
  - url: https://api.example.com
    x-openweb:
      transport: page
paths:
  /api/v1/categories:
    get:
      operationId: getCategories
      x-openweb:
        transport: node   # this endpoint works without browser
```

> Bot detection details and transport impact: `knowledge/bot-detection.md`

---

## Auth Configuration

Auth is **site-level** — applies to all operations. Never remove auth to make
read-only verify pass. Write operations depend on it.

### Auth Types

| Type | Quick signal |
|------|-------------|
| `cookie_session` | Session cookies across requests |
| `localStorage_jwt` | JWT (`eyJ…`) in localStorage |
| `exchange_chain` | POST to token endpoint → bearer |
| `webpack_module_walk` | Token in webpack chunk cache |
| `page_global` | Auth data in `window.*` global |
| `sessionStorage_msal` | MSAL tokens in sessionStorage |

> Full primitive config: `knowledge/auth-primitives.md` —
> Quick routing (signals → family): `knowledge/auth-routing.md`

### Example: Cookie Session + CSRF

```yaml
servers:
  - url: https://api.example.com
    x-openweb:
      transport: node
      auth:
        type: cookie_session
      csrf:
        type: cookie_to_header
        cookie: ct0
        header: x-csrf-token
        scope: [POST, PUT, DELETE]
```

### Cross-Domain Auth

When the token lives on a different domain than the API, use `app_path` with an
absolute URL. The resolver opens a temporary page to read the token storage.
Applies to `localStorage_jwt` and `webpack_module_walk`.

```yaml
auth:
  type: localStorage_jwt
  key: BSKY_STORAGE
  path: session.currentAccount.accessJwt
  app_path: https://bsky.app   # token domain ≠ API domain
  inject:
    header: Authorization
    prefix: "Bearer "
```

### CSRF Types

| Type | Mechanism | Key fields |
|------|-----------|------------|
| `cookie_to_header` | Cookie value → request header | `cookie`, `header` |
| `meta_tag` | `<meta>` tag content → header | `name`, `header` |
| `api_response` | Endpoint → extract → inject | `endpoint`, `extract`, `inject` |

`scope` controls which methods require CSRF — typically `["POST", "PUT", "DELETE"]`.
Some sites require CSRF on GET too (X/Twitter, LinkedIn) — check captured traffic.

### Signing

One runtime primitive: `sapisidhash` (YouTube/Google). Custom signing
(X-Bogus, `x-client-transaction-id`) requires adapter + page transport — not a
runtime primitive.

---

## Per-Operation Overrides

Disable server-level auth/CSRF/signing on genuinely public operations:

```yaml
paths:
  /api/v1/public/categories:
    get:
      operationId: getCategories
      x-openweb:
        auth: false
        csrf: false
```

Never remove site-level auth — override with `false` at the operation level.

---

## Extraction vs Adapter

### Extraction (Declarative YAML)

Use when a single `page_url` + expression reaches the data, including
parameterized URLs (e.g., `/dp/{asin}`). The executor resolves path params,
navigates, and evaluates.

| Type | Use when | Key fields |
|------|----------|------------|
| `ssr_next_data` | Next.js `__NEXT_DATA__` | `page_url`, `path` |
| `page_global_data` | `window.*` global | `page_url`, `expression`, `path` |
| `html_selector` | Data in DOM elements | `page_url`, `selectors`, `attribute` |
| `script_json` | `<script type="application/json">` | `selector`, `path` |

**Decision flow:** Prefer API > JSON extraction > DOM extraction > adapter.

**Complexity rule:** If expression exceeds ~5 lines, move to an adapter.
Inline OK for simple `ssr_next_data`, `page_global`, short `html_selector`.

> Pattern catalog: `knowledge/extraction.md`

### Adapter (TypeScript Code)

Use when extraction isn't enough:
- Multi-step navigation, dynamic waits, click/scroll interactions
- Multiple operations sharing the same real URL (differentiated by params or DOM region)
- Complex request signing that only runs in browser context
- DOM interaction beyond a single `page.evaluate()` expression

```yaml
x-openweb:
  adapter: ./adapters/<site>.ts
```

Adapters must be **self-contained** — no imports from outside the adapter directory.

### Adapter Path Semantics

For non-adapter operations, the OpenAPI path **is** the real URL path.

For adapter operations, the path is a **logical namespace** — the runtime does
NOT navigate to it. It uses `operationId` to route to the adapter. The adapter
must use `params` to navigate.

```yaml
# Logical paths — NOT real URLs:
/search/images:     # real: /search?q=...&udm=2
/search/news:       # real: /search?q=...&tbm=nws
/search/knowledge:  # real: /search?q=... (sidebar)
```

**Consequences:**
1. The adapter must call `page.goto()` — runtime only opens the server origin
2. Use `params` to build URLs — never write `_params` (unused)
3. Path naming is free — choose names clear to API consumers

#### Adapter init() / execute() Patterns

**init() should be permissive** — only check hostname. Do NOT navigate:
```typescript
async init(page) {
  return new URL(page.url()).hostname.includes('example.com')
}
```

**execute() must navigate.** Catch `ERR_ABORTED` — SPA routers intercept
navigation and abort the initial load, but the page still renders correctly.
Use `waitForSelector` over fixed delays (`.catch(() => {})` to tolerate slow loads):
```typescript
await page.goto(url, { waitUntil: 'load', timeout: 15000 }).catch(() => {})
await page.waitForSelector('.content', { timeout: 10000 }).catch(() => {})
```

---

## Common Mistakes

1. **Removing site-level auth for verify.** Auth exists for write ops. Use
   `auth: false` per-operation for public endpoints.

2. **"Needs browser for each request" in DOC.md.** With `node` + `cookie_session`,
   cookies are extracted once and cached. Say "cookies extracted automatically."

3. **Adapter not navigating.** Runtime opens server origin only. Adapter must
   use params to build URL and `page.goto()`.

4. **Editing `build` fields.** Compiler-managed — never change manually.

5. **Extraction when an API exists.** If the site makes XHR/fetch calls, use
   the API directly. Extraction is for SSR-only data.
