# Adapter Recipes

5 canonical patterns with decision boundaries, code templates, and pitfalls.

> **Important (as of 2026-04-17 normalize-adapter v2):** Prefer spec primitives over adapter code when they cover your case. In particular:
> - "Response interception" below is now the `response_capture` extraction type — use the spec primitive, not an adapter.
> - "Navigate + DOM extract" is now `page_global_data` / `html_selector` / `script_json` with PagePlan — use extraction, not an adapter.
> - Only keep an adapter (now called `CustomRunner`) when the site genuinely needs signing, module-system access, binary protocols, or other site-specific logic that spec cannot express.
>
> When you do write a runner, the contract is `run(ctx: PreparedContext)` — a single function. Adapters can optionally define `warmReady?(page)` to probe per-site readiness during warm-up — runtime polls it until true or `warmTimeoutMs` (default 15000ms) elapses. Use for SPAs whose hydration the runtime can't detect via cookies (Telegram webpack chunks, IndexedDB-backed sessions). The runtime's PagePlan handles general initialization; auth resolution happens before `run(ctx)`. See `doc/main/adapters.md` for the current CustomRunner interface. `PreparedContext` provides `{ page, operation, params, helpers, auth, serverUrl }` — destructure what you need at the top of `run()`.

## Raw-API Principle (read first)

OpenWeb exposes the **wire shape** the upstream returns. Response schemas describe what the server actually sends — not a prettified projection. Agents compose multi-step workflows themselves using the per-site SKILL.md as the guide; the runtime stays out of orchestration and aesthetics.

This collapses three categories of would-be runtime work into spec + agent-side composition: chaining is an agent concern, reshape is a documentation concern, and force-fitting permanent-custom-bucket sites into shared primitives is an anti-pattern. The result is a smaller runtime surface, fewer parallel semantics for the same job, and adapters that only own their genuinely unique work.

### Three hard rules going forward

1. **Do not add a `CustomRunner` just to chain two calls** (splitting into separate ops + SKILL.md is the answer).
2. **Do not add a runtime primitive whose only purpose is to rename wire fields or compose nested objects** (describe the wire in the schema).
3. **Do not add "unsafe mode" flags to shared primitives to accommodate permanent-custom-bucket sites.**

**Revisit criteria** — open a fresh `/design` only when at least one of: (a) 10+ sites show the same pattern, (b) measurable agent-side failure rate, (c) runtime-level batching / caching / validation makes server-side handling materially cheaper than client-side. Until then these sit as design questions, not backlog tasks.

-> See: `doc/todo/normalize-adapter/impl_summary.md` for the full rationale and the cancelled tasks (`na-rt-multicall-composition`, `na-rt-response-transform`, `na-rt-array-reducers`, `na-rt-tiktok-signed-capture`) that this principle resolves.

## 1. Response Interception

Capture API responses that fire during page navigation — the data arrives as a side effect of loading the page, not from an explicit fetch you control.

### When to Use

- The API call fires during page load (triggered by client-side JS, not by your code)
- You need the JSON payload from a background XHR/fetch that the page makes automatically
- The response URL is predictable (static string or regex-matchable)

### When NOT to Use

- You can call the API directly with `pageFetch` or `graphqlFetch` — prefer explicit calls
- The response requires authentication cookies that only exist after interaction (use pageFetch after navigation instead)
- Multiple matching responses fire and you need a specific one (the helper captures the first match)

### Template

```typescript
// interceptResponse: register listener BEFORE navigation, capture first matching response
async run(ctx: PreparedContext) {
  const { page, params, helpers } = ctx
  const { errors } = helpers
  if (!page) throw errors.fatal('this runner requires a page (transport: page)')

  // Import interceptResponse directly — it's exported from adapter-helpers but not on the helpers object
  const { interceptResponse } = await import('../../../lib/adapter-helpers.js')

  const slug = params.slug as string
  if (!slug) throw errors.missingParam('slug')

  const data = await interceptResponse(page, {
    urlMatch: '/api/v1/items/',          // substring match — or use RegExp
    navigateUrl: `https://example.com/items/${slug}`,
    waitUntil: 'domcontentloaded',       // 'load' is default; use 'domcontentloaded' if response arrives early
    timeout: 12_000,
  })

  return data
}
```

### Common Pitfalls

- **Listener registered too late:** `interceptResponse` handles this correctly (registers before navigation), but if you manually wire `page.on('response')`, register it before `page.goto`.
- **Multiple matching URLs:** The helper returns the first match. If the page fires `/api/v1/items/` for both a list and a detail call, tighten the `urlMatch` regex.
- **`useLocationHref` option:** Set to `true` when `page.goto()` fails on SPAs that intercept navigation. This uses `window.location.href = url` + `waitForNavigation` instead.

---

## 2. Node HTML Parse

Fetch HTML server-side and extract embedded data via regex or string parsing. No browser needed.

### When to Use

- Data is embedded in HTML (SSR `__NEXT_DATA__`, `ld+json`, inline `<script>` assignments)
- No bot detection (no Akamai, DataDome, PerimeterX, Cloudflare challenge)
- A simple `fetch()` with a User-Agent header returns the full page

### When NOT to Use

- The site has bot detection — you'll get a challenge page, not data
- Data loads via client-side JS after initial HTML (SPA hydration)
- You need cookies/session state that only a browser can establish

### Template

```typescript
import { nodeFetch } from '../../../lib/adapter-helpers.js'

async run(ctx: PreparedContext) {
  const { page, params, helpers } = ctx
  const { errors } = helpers
  // page may be null when spec declares x-openweb.transport: node — that's fine here
  const id = params.id as string
  if (!id) throw errors.missingParam('id')

  const url = `https://example.com/items/${encodeURIComponent(id)}`
  const result = await nodeFetch({ url })
  if (result.status >= 400) throw errors.httpError(result.status)

  const html = result.text

  // Pattern A: __NEXT_DATA__
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (nextDataMatch) {
    const payload = JSON.parse(nextDataMatch[1])
    return payload.props.pageProps
  }

  // Pattern B: ld+json
  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  if (ldMatch) {
    return JSON.parse(ldMatch[1])
  }

  // Pattern C: inline variable assignment
  const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/)
  if (stateMatch) {
    return JSON.parse(stateMatch[1])
  }

  throw errors.apiError('parse', 'No extractable data found in HTML')
}
```

### Common Pitfalls

- **Bot block masquerading as success:** Some sites return 200 with a captcha/challenge page. Check for markers like `/captcha`, `blocked.html`, or abnormally short responses.
- **Greedy regex:** `[\s\S]*` is greedy — use `[\s\S]*?` (non-greedy) to avoid capturing past the closing tag.
- **JSON with HTML entities:** Some inline JSON contains escaped characters. May need `unescape()` or entity decode before `JSON.parse`.
- **`page` is null for node transport:** When the spec declares `x-openweb.transport: node`, the runtime passes `page: null`. Guard accordingly.

---

## 3. Toggle-Param Reverse Ops

One real API endpoint serves multiple logical operations, differentiated by a parameter value. Model as virtual operations in the spec, map to a single implementation.

### When to Use

- The API has a `type`, `action`, `category`, or similar parameter that changes the response shape
- Multiple spec operations resolve to the same URL path (use `x-openweb.actual_path`)
- You want distinct, discoverable operations in the CLI but share the underlying call

### When NOT to Use

- The operations have genuinely different endpoints — just model them separately
- The parameter changes are trivial (e.g., pagination) — that's a single operation with optional params

### Template

**In openapi.yaml — virtual paths pointing to the same actual endpoint:**

```yaml
/search/products:
  get:
    operationId: searchProducts
    x-openweb:
      actual_path: /api/search
    parameters:
      - name: query
        in: query
        required: true
      - name: type
        in: query
        schema:
          const: product   # fixed site-defined value; caller cannot override

/search/users:
  get:
    operationId: searchUsers
    x-openweb:
      actual_path: /api/search
    parameters:
      - name: query
        in: query
        required: true
      - name: type
        in: query
        schema:
          const: user
```

**In adapter — shared implementation:**

```typescript
async run(ctx: PreparedContext) {
  const { page, operation, params, helpers } = ctx
  const { pageFetch, errors } = helpers
  if (!page) throw errors.fatal('this runner requires a page (transport: page)')
  const query = params.query as string
  if (!query) throw errors.missingParam('query')

  // Map operation to the toggle parameter
  const typeMap: Record<string, string> = {
    searchProducts: 'product',
    searchUsers: 'user',
  }
  const searchType = typeMap[operation]
  if (!searchType) throw errors.unknownOp(operation)

  const url = `https://example.com/api/search?q=${encodeURIComponent(query)}&type=${searchType}`
  const result = await pageFetch(page, { url, method: 'GET' })
  return JSON.parse(result.text)
}
```

### Common Pitfalls

- **Using a fake `x-openweb.injected` field:** it does not exist. Use `schema.const` for fixed wire params, or `x-openweb.template` when one param is derived from another.
- **Response shape divergence:** Even though the endpoint is shared, different toggle values may return different shapes. Validate per-operation, not just per-endpoint.
- **Spec drift:** When the real endpoint changes, all virtual ops break simultaneously. This is actually a benefit — one fix propagates everywhere.

---

## 4. Webpack Module Walk

Discover internal APIs or extract runtime state by walking the webpack module registry inside the browser.

### When to Use

- SPA with no visible API endpoints in network traffic, but rich client-side data
- Need to extract API URLs, auth tokens, or persisted query hashes from bundled code
- Data is trapped inside webpack module closures (not on `window`)

### When NOT to Use

- Data is available via network API or DOM extraction — simpler patterns first
- The site minifies/obfuscates module IDs on every deploy — the walk becomes fragile
- You only need a single global variable — use `page.evaluate(() => window.VAR)` instead

### Template

```typescript
// Extract the webpack require function, then walk modules
const result = await page.evaluate(() => {
  // Step 1: Find the webpack chunk array (name varies by site)
  const w = window as Record<string, unknown>
  const chunks = (w.webpackChunk_app ?? w.webpackChunksite_name) as unknown[] | undefined
  if (!chunks || !Array.isArray(chunks)) return null

  // Step 2: Extract the internal require function
  let require: ((id: string) => Record<string, unknown>) | null = null
  chunks.push([[Symbol()], {}, (r: unknown) => { require = r as typeof require }])
  chunks.pop()  // clean up the probe entry
  if (!require) return null

  // Step 3: Walk module exports to find what you need
  const moduleMap = (require as unknown as { m: Record<string, unknown> }).m
  for (const id of Object.keys(moduleMap)) {
    try {
      const mod = require!(id)
      // Look for a specific export shape — e.g., an API_BASE_URL string
      for (const key of Object.keys(mod)) {
        const val = mod[key]
        if (typeof val === 'string' && val.startsWith('https://api.')) {
          return { apiBase: val, moduleId: id }
        }
      }
    } catch { /* module may throw on require */ }
  }
  return null
})
```

### Common Pitfalls

- **Chunk array name changes:** The global name (e.g., `webpackChunk_N_E`, `webpackChunktelegram_t`) is site-specific and can change on redeploy. Check the actual name in devtools first.
- **Module side effects:** Calling `require(id)` on some modules triggers side effects (network calls, DOM mutations). Wrap in try/catch and expect failures.
- **Timing:** Run the walk after the main bundle has loaded. Use `waitForSelector` or `waitForFunction` to confirm the chunk array exists before evaluating.
- **Serialization:** `page.evaluate` serializes return values. Functions, circular refs, and DOM nodes won't survive the boundary. Extract primitive data only.

---

## 5. SPA Navigation Workarounds

Techniques for when standard `page.goto()` fails or returns stale/cached content in single-page applications.

### When to Use

- `page.goto()` returns but the page content is stale or from a previous navigation
- The site's client-side router intercepts navigation and prevents a full page load
- Same-origin navigation reuses the existing page state instead of fetching fresh data
- Bot detection triggers on direct `goto()` but not on in-page navigation

### When NOT to Use

- Standard `page.goto()` works reliably — don't add complexity
- The site is server-rendered (SSR) — `goto` should work fine
- You're already using `interceptResponse` which handles navigation internally

### Template

**Pattern A: about:blank reset (forces fresh navigation)**

```typescript
async run(ctx: PreparedContext) {
  const { page, params, helpers } = ctx
  const { errors } = helpers
  if (!page) throw errors.fatal('this runner requires a page (transport: page)')
  const url = `https://example.com/items/${params.id}`

  // Navigate away first to force a clean page load
  await page.goto('about:blank')
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })

  // Now the page has fresh content
  await page.waitForSelector('[data-testid="item-title"]', { timeout: 10_000 })
  return page.evaluate(() => {
    // ... extract data
  })
}
```

**Pattern B: location.href assignment (bypasses client-side router)**

```typescript
// Use when page.goto is intercepted by the SPA router
await Promise.all([
  page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 }),
  page.evaluate((u: string) => { window.location.href = u }, targetUrl),
])
```

**Pattern C: waitUntil tuning**

```typescript
// 'domcontentloaded' — fast, for sites where data is in initial HTML
await page.goto(url, { waitUntil: 'domcontentloaded' })

// 'networkidle' — slow but thorough, for SPAs that fetch data after load
await page.goto(url, { waitUntil: 'networkidle' })

// Catch + continue — some SPAs throw navigation errors that are safe to ignore
await page.goto(url, { waitUntil: 'load' }).catch(() => {})
await page.waitForSelector('.content-loaded', { timeout: 10_000 })
```

### Common Pitfalls

- **about:blank overhead:** Each `about:blank` round-trip adds ~200-500ms. Only use when stale content is actually a problem.
- **`waitForNavigation` race:** Always start `waitForNavigation` before triggering the navigation (via `Promise.all`). Starting it after risks missing the event.
- **`networkidle` timeout:** `networkidle` waits for 500ms of no network activity. Sites with analytics/polling never go idle. Use `domcontentloaded` + explicit `waitForSelector` instead.
- **Navigation errors are often harmless:** SPAs commonly throw `net::ERR_ABORTED` during client-side routing. The `.catch(() => {})` pattern is intentional, not sloppy — but always follow with a `waitForSelector` to confirm the page actually loaded.

---

## Decision Matrix

| Signal | Recipe |
|--------|--------|
| API response fires during page load, not callable directly | Response Interception |
| Data in HTML, no bot detection, no JS needed | Node HTML Parse |
| Same endpoint, different behavior via a param value | Toggle-Param Reverse Ops |
| SPA with no visible API, data in bundled JS | Webpack Module Walk |
| `page.goto()` returns stale/cached content | SPA Navigation Workaround |

**Stability ranking** (most to least stable): Node HTML Parse > Response Interception > Toggle-Param > SPA Workaround > Webpack Module Walk.

Choose the simplest pattern that works. Combine patterns when needed — e.g., SPA workaround + response interception for sites that need both fresh navigation and API capture.

---

## Appendix: GitHub-style Verified-Fetch Nonce (CSRF)

Some sites have moved past the global `<meta name="csrf-token">` pattern in favor of a per-page **fetch nonce** + **verified-fetch flag**. GitHub is the reference example (2026-04). When you find a site with no global csrf-token meta but mutations still authenticate, check for this pattern.

**Signals:**
- No `<meta name="csrf-token">` on the page
- Has `<meta name="fetch-nonce">` (or similar named nonce meta)
- Mutation requests carry an extra header like `GitHub-Verified-Fetch: true` or `<Site>-Verified-Fetch: true`
- Mutations 403 without those headers, even with valid cookies

**Recipe:**

```typescript
const ctx = await page.evaluate(() => ({
  nonce: document.querySelector('meta[name="fetch-nonce"]')?.getAttribute('content') ?? '',
}))
await page.evaluate(async ({ url, body, nonce }) => {
  return fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Fetch-Nonce': nonce,                // per-page nonce
      'GitHub-Verified-Fetch': 'true',       // attestation flag
    },
    body,
  })
}, { url, body, nonce: ctx.nonce })
```

**Combined with rails per-form `authenticity_token`:** some endpoints (e.g. github star/unstar) want BOTH the nonce header AND a per-form `authenticity_token` scraped from `form[action$="/<action>"] input[name="authenticity_token"]`. Other endpoints on the same site (e.g. github `/notifications/subscribe`) want only the nonce header. Capture the real request via DevTools to know which combination applies.

**Combined with persisted-query GraphQL:** the same nonce envelope works for private GraphQL endpoints. GitHub's `/_graphql` (note the underscore — not the public `/graphql`) uses body shape `{persistedQueryName, query: <md5-hash>, variables}` instead of the standard `{operationName, extensions.persistedQuery.sha256Hash, variables}`. Persisted-query hashes drift with web releases — hardcode + plan to re-capture from a real DevTools click when verify breaks.
