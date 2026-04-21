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
| `auth_check` | AuthCheckPrimitive | When site signals "unauthenticated despite HTTP 200" via body shape |
| `headers` | `Record<string, string>` | If site needs constant headers (e.g., User-Agent override) |

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

> **Probe-first rule:** Transport is now an INPUT from the probe step, not
> discovered during curation. The probe matrix records a transport hypothesis
> (`node_candidate`, `page_required`, `adapter_required`, `intercept_required`,
> or `extraction`). Curation configures the spec to match that hypothesis.
> `node_candidate` is provisional — only trusted after verify passes.

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
For `api_response`, make `endpoint` an **absolute HTTPS URL**. The resolver SSRF-validates that URL directly, then fetches it in page context so rotated cookies stay aligned with the browser jar.

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
        signing: false
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

**Extraction priority** (high to low):
1. **API** (JSON response) — cleanest, most stable, clearest schema
2. **SSR JSON** (`__NEXT_DATA__`, `__INITIAL_STATE__`, LD+JSON) — structured data, no render dependency
3. **In-page JSON** (script tags, window globals) — structured but less predictable sources
4. **DOM** — last fallback, slowest and most fragile. If DOM extraction exceeds ~5 lines, escalate to adapter.

**Complexity rule:** If expression exceeds ~5 lines, move to an adapter.
Inline OK for simple `ssr_next_data`, `page_global`, short `html_selector`.

> Pattern catalog: `knowledge/extraction.md`

> **Adapter is a first-class lane.** Adapter/intercept is a normal routing
> outcome from the probe step, not a late escalation from failed replay.
> If probe evidence says adapter is the right path, route there directly.

### Adapter (TypeScript Code)

Use when extraction isn't enough:
- Multi-step navigation, dynamic waits, click/scroll interactions
- Multiple operations sharing the same real URL (differentiated by params or DOM region)
- Complex request signing that only runs in browser context
- DOM interaction beyond a single `page.evaluate()` expression

```yaml
x-openweb:
  adapter:
    name: site-name
    operation: operationName
```

The runner contract is a single `run(ctx: PreparedContext)` entry. The runtime injects
shared helpers on `ctx.helpers`:

- `helpers.pageFetch(page, { url, method?, body?, headers?, timeout? })` — browser-context fetch, returns `{ status, text }`
- `helpers.graphqlFetch(page, { url, operationName, variables, hash?, query?, batched? })` — GraphQL fetch, returns unwrapped `data`
- `helpers.ssrExtract(page, source, path?)`, `helpers.jsonLdExtract(page, typeFilter?)`, `helpers.domExtract(page, spec)` — extraction helpers
- `helpers.errors` — error factories: `unknownOp`, `missingParam`, `httpError`, `apiError`, `needsLogin`, `botBlocked`, `fatal`, `retriable`, `wrap`

`nodeFetch` and `interceptResponse` are **not** injected on `ctx.helpers`. Import them directly from `../../../lib/adapter-helpers.js` when needed; the build step bundles those imports into the emitted adapter `.js`.

### Intercept Pattern

When the site's own JS must trigger the API call (e.g., client-side signing
like JD's `h5st`, Akamai sensor-blocked `page.evaluate(fetch)`), use the
shared `interceptResponse()` helper from `src/lib/adapter-helpers.ts`:

```typescript
import { interceptResponse } from '../../../lib/adapter-helpers.js'

const data = await interceptResponse(page, {
  urlMatch: '/api/v1/items/',
  navigateUrl: `https://example.com/items/${slug}`,
  waitUntil: 'domcontentloaded',
  timeout: 20_000,
})
```

See `knowledge/adapter-recipes.md` §Response Interception for the full pattern
and decision boundary vs `pageFetch`.

Real examples:
- `src/sites/homedepot/adapters/homedepot-web.ts` — generic `interceptGraphQL()` helper
- `src/sites/jd/adapters/jd-global-api.ts` — multi-API interception from one navigation
- `src/sites/instacart/adapters/instacart-graphql.ts` — dual request+response interception

Adapter `.ts` files are authored directly in `src/sites/<site>/adapters/`.
`pnpm build` compiles `.ts` → `.js` and syncs to `$OPENWEB_HOME` and `dist/`.

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

#### CustomRunner Patterns

**No more `init()` / `isAuthenticated()`.** PagePlan handles navigation and
readiness at the runtime layer; auth is pre-resolved from the declared
primitive into `ctx.auth`. The runner only owns site-specific acquisition.

Declare the page lifecycle in the spec, not the runner:
```yaml
servers:
  - url: https://www.example.com
    x-openweb:
      transport: page
      page_plan:
        entry_url: /app
        ready: '.content'
        warm: true
```

> **`warm_origin` default:** when `entry_url.origin !== serverUrl.origin`, warm
> uses the entry_url origin; otherwise warm uses serverUrl. Override with
> explicit `warm_origin: 'page' | 'server' | <URL string>`.

The runner becomes a single `run(ctx)` entry with a switch on `ctx.operation`:
```typescript
import type { CustomRunner, PreparedContext } from '../../../types/adapter.js'

const runner: CustomRunner = {
  name: 'example-web',
  description: 'Example site runner',
  async run(ctx: PreparedContext) {
    const page = ctx.page!   // null only when transport: node
    switch (ctx.operation) {
      case 'getItems': {
        const result = await ctx.helpers.pageFetch(page, { url: `/api/items?q=${ctx.params.q}`, method: 'GET' })
        if (result.status >= 400) throw ctx.helpers.errors.httpError(result.status)
        return JSON.parse(result.text)
      }
      default:
        throw ctx.helpers.errors.unknownOp(ctx.operation)
    }
  },
}
export default runner
```

**Do not** hand-roll `page.goto` / `waitForSelector` / cookie warmup in the
runner — PagePlan already did that. **Do not** add a runner just to chain
two calls or to rename wire fields — expose ops separately and document in
SKILL.md.

`ctx.auth` is the only request material pre-resolved into `PreparedContext`. Server-level CSRF/signing config is not injected into adapter ops automatically.

---

## Common Mistakes

1. **Removing site-level auth for verify.** Auth exists for write ops. Use
   `auth: false` per-operation for public endpoints.

2. **"Needs browser for each request" in DOC.md.** With `node` + `cookie_session`,
   cookies are extracted once and cached. Say "cookies extracted automatically."

3. **Hand-rolling navigation in a runner.** PagePlan's `entry_url` + `ready`
   handle navigation + readiness before `run(ctx)` is invoked. Don't write
   `page.goto` / `waitForSelector` inside the runner — declare them in
   `x-openweb.page_plan` on the operation or server.

4. **Editing `build` fields.** Compiler-managed — never change manually.

5. **Extraction when an API exists.** If the site makes XHR/fetch calls, use
   the API directly. Extraction is for SSR-only data.

6. **`replay_safety` placed in spec `x-openweb` instead of `example.json`.** The spec
   uses `safety` (values: `safe`, `caution`). The `example.json` uses `replay_safety`
   (values: `safe_read`, `unsafe_mutation`).
7. **Assuming `auth: false` also disables signing.** It does not. Public ops that must bypass signing or CSRF need their own `signing: false` / `csrf: false`.
