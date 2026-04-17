# Open Questions — Resolved

All 14 open questions from the aligned design, resolved against actual codebase state.

---

## OQ 1: `x-openweb.page` schema and precedence

**Answer: Follow the existing `transport` precedence pattern — operation merges over server.**

Schema:

```yaml
# Server-level (default for all ops on this server)
servers:
- url: https://www.example.com
  x-openweb:
    transport: page
    page:
      ready: "#app"
      warm: true

# Operation-level (overrides/extends server-level)
paths:
  /search:
    get:
      x-openweb:
        page:
          entry_url: /search
          ready: ".search-results"
          settle_ms: 500
```

Fields:

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `entry_url` | string | server URL | Where to navigate before executing |
| `match` | string | origin match | URL pattern for page reuse (glob) |
| `ready` | string | `undefined` | CSS selector or `"networkidle"` — page is ready when this resolves |
| `wait_until` | string | `"load"` | Playwright `waitUntil` value for navigation |
| `settle_ms` | number | `0` | Extra delay after `ready` resolves |
| `warm` | boolean | `false` | Run `warmSession()` after readiness |

Merge rule: **field-level merge, not replace.** Operation fields override server fields; unset operation fields inherit from server. Same pattern as how `getServerXOpenWeb()` already merges auth/csrf/signing (`operation-context.ts:36-45`).

Implementation: add `page?: PagePlan` to `XOpenWebServer` and `XOpenWebOperation` in `types/extensions.ts`. Add `resolvePagePlan(spec, operation)` to `operation-context.ts` alongside `resolveTransport()`.

---

## OQ 2: Host/origin parameterization for multi-subdomain sites

**Answer: Implement standard OpenAPI server variables. No custom extension needed.**

OpenAPI already defines server variables:

```yaml
servers:
- url: https://{subdomain}.substack.com
  variables:
    subdomain:
      default: www
  x-openweb:
    transport: page
```

Today `getServerUrl()` in `spec-loader.ts` returns the raw `https://{subdomain}.substack.com` — no substitution. Fix: resolve `{varName}` placeholders from:

1. Caller-provided params (input parameter named `subdomain`)
2. `servers[].variables[varName].default` as fallback

This is standard OpenAPI behavior. No invention required.

Implementation: ~15 lines in `spec-loader.ts` `getServerUrl()` — regex replace `{varName}` from merged params + server variable defaults.

---

## OQ 3: SSR primitive — new or extend existing?

**Answer: No new primitive. Extend `script_json` minimally. Existing primitives already cover all SSR patterns.**

Evidence from codebase:

| SSR Pattern | Already Covered By |
|-------------|-------------------|
| Next.js `__NEXT_DATA__` | `ssr_next_data` (browser + node paths) |
| `<script type="application/json">` | `script_json` with CSS selector |
| Vue `__INITIAL_STATE__` | `page_global_data` with `expression: "window.__INITIAL_STATE__"` |
| Apollo `__ref` resolution | Adapter code (site-specific graph traversal) |
| LD+JSON `<script type="application/ld+json">` | `script_json` with `selector: 'script[type="application/ld+json"]'` |
| HTML comment-wrapped JSON (Yelp) | Not covered — extend `script_json` |

One extension to `script_json`:

```typescript
// Add to ExtractionPrimitive script_json variant:
readonly strip_comments?: boolean  // Strip <!-- --> wrapping before JSON.parse
```

This covers Yelp's pattern where `<script type="application/json">` content is wrapped in HTML comments.

Why not `ssr_hydration`? Because:
- Vue Ref `._rawValue` unwrapping is Vue-version-specific (site-specific)
- Apollo `__ref` resolution is a graph traversal (site-specific)
- These "SSR semantics" are framework internals, not generic extraction

---

## OQ 4: DOM extraction scope — where is the line?

**Answer: No new `dom_list`/`dom_object` primitives. The line is already clear: `html_selector` for trivial flat cases, `page_global_data` for everything else.**

Evidence: BBC-News and CNN specs already use `page_global_data` with full JS expressions that do `document.querySelectorAll()`. This pattern is established and working.

The line:

| Use | Primitive | Example |
|-----|-----------|---------|
| 1-5 selectors, all textContent, flat | `html_selector` | Extract page title + description |
| Per-field attributes, nesting, logic | `page_global_data` + expression | BBC-News, CNN, most DOM adapters |
| Multi-source merge (SSR + DOM) | Adapter (custom) | Yelp, Airbnb |

Why not `dom_list`/`dom_object` in YAML?
- **YAML is the wrong language for DOM traversal logic.** The moment you need per-field attribute selection (`textContent` vs `href` vs `src`), conditional fallbacks, or array mapping, you're writing code — just in an awkward YAML DSL.
- `page_global_data` with an inline JS expression is strictly more powerful, equally declarative (it's in the spec YAML), and doesn't require a new type system.
- Adapters like Boss (50 DOM refs) and Google Search (77 DOM refs) would produce unreadable YAML. They're better as `page_global_data` expressions.

---

## OQ 5: Ship adapter extraction helpers alongside or after spec primitives?

**Answer: Ship simultaneously. They share code and serve non-overlapping use cases.**

Spec primitives delete adapters. Helpers serve adapters that stay custom for other reasons.

Example: an adapter that extracts SSR state, uses a value to call an API, then merges results. That adapter stays custom because of the multi-step flow — but the SSR extraction step should use a shared helper rather than hand-rolling regex parsing.

Implementation: helpers call the same resolver functions (`resolveScriptJson`, `resolveHtmlSelector`, etc.) that the extraction executor uses. They're thin wrappers injected via `AdapterHelpers` in `adapter-executor.ts`.

---

## OQ 6: GraphQL and capture — distinct strategies or extensions?

**Answer: GraphQL = extensions to existing request fields. Capture = new extraction type.**

**GraphQL** is request shaping, not a new execution strategy. The existing fields already handle it:

```yaml
x-openweb:
  wrap: variables
  graphql_query: "query GetUser($id: ID!) { user(id: $id) { name } }"
  unwrap: data.user
```

Add one field for persisted queries:

```yaml
x-openweb:
  graphql_hash: "sha256:abc123..."  # persisted query hash
  wrap: variables
  unwrap: data.user
```

Transport is still `page` or `node`. Executor is still `browser_fetch` or `session_http`. The GraphQL fields just control request body construction in `request-builder.ts`.

**Capture** is fundamentally different — it intercepts responses during navigation rather than making a request. Add as new extraction type:

```yaml
x-openweb:
  extraction:
    type: response_capture
    page_url: /flights/search
    match_url: "*/api/search/flights*"
    unwrap: data.results
```

Runtime: navigate to `page_url`, register `page.on('response')` handler matching `match_url` pattern, wait for first match, parse + unwrap. This mirrors what `interceptResponse()` in `adapter-helpers.ts:215-264` already does.

---

## OQ 7: Generic GraphQL patterns beyond fixed/persisted?

**Answer: None in the first cut. No middle ground exists.**

| Pattern | Status | Reason |
|---------|--------|--------|
| Fixed inline query | Generic | Static string in spec |
| Persisted query hash | Generic | Static hash in spec |
| Dynamic bundle scanning (LinkedIn) | Custom | Anti-scraping rotation, JS chunk parsing |
| API-response query-id (X) | Custom | Extracted from prior API calls, changes per deploy |
| Pathfinder API (Spotify) | Custom | Different endpoint, dynamic bearer token |

Bundle scanning and query-id rotation are site-specific anti-scraping countermeasures. If a generic pattern emerges (e.g., "query hashes in public manifest.json"), revisit then.

---

## OQ 8: Progressive/multi-response capture abstraction?

**Answer: Custom indefinitely. No reusable abstraction.**

The patterns are fundamentally divergent:

| Site | Capture Pattern |
|------|----------------|
| Kayak | Progressive poll — same URL, response quality improves over time, "best of N" |
| TikTok | Intercept during SPA navigation — match URL pattern, multiple response types |
| Google Maps | Protobuf response decode — binary format, custom deserialization |
| Homedepot | Navigation-triggered GraphQL intercept — specific GQL operation name |

The simple case (navigate → intercept first matching response) is covered by the new `response_capture` extraction type. Everything else is genuinely site-specific state machine logic.

---

## OQ 9: Is unwrap + field mapping enough for first migration waves?

**Answer: Yes. Measure after Phases 1-3, don't design speculatively.**

For Phase 0-3 targets:
- **Pure API wrappers** (zhihu, seeking-alpha, hackernews): `unwrap` extracts nested response. Done.
- **Extraction sites** (boss, douban, yelp): the `page_global_data` expression already shapes the output. The JS expression IS the mapping.
- **SSR extraction** (goodreads, zillow): `path` traversal shapes the output.

The ~40 adapters doing field rename/type coercion fall into two buckets:
1. Adapters that stay custom for other reasons (extraction is one step) — helper handles extraction, adapter does mapping
2. Adapters that could become extraction-only — the `page_global_data` expression does both extraction AND mapping in one JS expression

A response-mapping DSL would only help if there's significant residual mapping code after Phases 1-3 strip away everything else. Premature to design now.

---

## OQ 10: Staged CodeAdapter migration path

**Answer: Three phases — defaults from spec, then new interface alongside old, then remove old.**

**Phase 1 — Runtime defaults (no interface change):**

In `adapter-executor.ts`, before calling `adapter.init()`:
1. Resolve PagePlan from spec
2. Navigate to `entry_url` if configured
3. Wait for `ready` condition
4. Run `warmSession()` if `warm: true`
5. THEN call `adapter.init(page)` — if adapter returns `true` (page was already ready), skip

For `isAuthenticated()`:
1. Resolve auth primitive from spec
2. If auth primitive resolves successfully → treat as authenticated
3. ONLY call `adapter.isAuthenticated()` if no auth primitive configured, or as override

Effect: adapters with trivial `init()` (just navigation) and trivial `isAuthenticated()` (just cookie check) can delete those methods. The runtime does it from spec.

**Phase 3+ — New interface alongside old:**

```typescript
interface CustomRunner {
  run(ctx: PreparedContext): Promise<unknown>
}

interface PreparedContext {
  page: Page | null
  operation: string
  params: Record<string, unknown>
  helpers: AdapterHelpers
  auth: AuthResult | undefined   // resolved auth from spec
  serverUrl: string
}
```

New adapters use `CustomRunner.run()`. Old adapters continue working through `CodeAdapter`. The executor checks which interface is implemented.

**Phase 5 — Remove old interface:**

Migrate remaining `CodeAdapter` implementations to `CustomRunner`. Delete `init()` / `isAuthenticated()` from contract.

---

## OQ 11: Disputed sites classification

| Site | Verdict | Rationale |
|------|---------|-----------|
| `instagram` | Custom | Multi-step API composition (username→userId→feed), auth guard logic |
| `goodrx` | Phase 2-3 candidate | Anti-bot = `warm: true`, extraction = `page_global_data`. Once PagePlan + warm land, most ops can normalize |
| `bluesky` | Custom | ATP/XRPC is a different protocol, dynamic PDS URL discovery |
| `youtube` | Custom | InnerTube API composition + sapisidhash (already a primitive) + protobuf params |
| `linkedin` | Custom | Dynamic queryId from JS bundle scanning (anti-scraping rotation) |
| `spotify` | Custom | Dynamic bearer token extraction + unique pathfinder GQL endpoint |
| `booking` | Partially normalizable | LD+JSON ops → `script_json`. Apollo SSR and GQL intercept ops stay custom. Net: ~40% line reduction |
| `costco` | Partially normalizable | Simple POST operations → spec after request parity lands. Complex multi-step ops stay custom. Net: ~30% line reduction |
| `google-maps` | Custom | Protobuf binary format, custom pb param encoding |

Summary:
- **Exclude from Phases 0-3:** instagram, bluesky, youtube, linkedin, spotify, google-maps
- **Partial normalization in Phase 3-4:** booking, costco, goodrx
- Total permanent custom bucket: 7 confirmed (bilibili, notion, opentable, telegram, tiktok, whatsapp, x) + 6 likely (instagram, bluesky, youtube, linkedin, spotify, google-maps) = ~13 sites

---

## OQ 12: When to publish hard per-wave counts?

**Answer: After Phase 0 is validated and the operation-level inventory is run.**

Phase 0 conversions (zhihu, hackernews) are the proof-of-concept. Once those work:
1. Run the Codex inventory script (node script counting adapter ops per site with server/auth hints)
2. Classify each operation (not site) as: canonical, near-spec, needs-Phase-1, needs-Phase-2, custom
3. Publish hard numbers per phase

Publishing now would be cargo-cult planning. The numbers depend on runtime gaps that Phase 1 closes.

---

## OQ 13: HTML-source / node execution support scope

**Answer: `ssr_next_data` (done), `script_json` (add), `json_ld` (add via script_json). `html_selector` and `page_global_data` stay browser-only.**

| Primitive | Node support | Rationale |
|-----------|-------------|-----------|
| `ssr_next_data` | Already implemented | `node-ssr-executor.ts` fetches HTML + parses `__NEXT_DATA__` |
| `script_json` | Add | Same pattern: fetch HTML, find `<script>` by selector, parse JSON. ~40 lines |
| `json_ld` | Via `script_json` | `selector: 'script[type="application/ld+json"]'` — no separate type needed |
| `html_selector` | Defer | Requires DOM parser (cheerio/jsdom) in Node. Not justified yet — most DOM sites need browser for bot bypass anyway |
| `page_global_data` | Never | Requires JS execution context (browser) |

Source selection model: **automatic, same as current ssr_next_data logic** (`http-executor.ts:251-267`):

```
if extraction.type in ['ssr_next_data', 'script_json']
  AND transport === 'node'
  AND no auth/csrf required
  → executeNodeExtraction()  // renamed from executeNodeSsr()
else
  → executeExtraction()  // browser path
```

Implementation: generalize `node-ssr-executor.ts` to `node-extraction-executor.ts` with a `switch` on extraction type. Add `parseScriptJson(html, selector, path)` alongside existing `parseNextData(html)`.

---

## OQ 14: PagePlan vs extraction-executor page-targeting

**Answer: PagePlan replaces extraction-executor's ad-hoc page management. One shared module, all executors use it.**

Current state — three executors each manage pages differently:

| Executor | Page logic | Lines |
|----------|-----------|-------|
| `extraction-executor.ts` | `findPageForTarget()` → `newPage()` + `goto()` → `autoNavigate()` fallback | 32-155 |
| `browser-fetch-executor.ts` | `findPageForOrigin()` → `autoNavigate()` | via session-executor |
| `adapter-executor.ts` | Delegates to `adapter.init()` which hand-rolls navigation | 113-140 |

Target state — one shared function:

```typescript
// New file: src/runtime/page-plan.ts

interface PagePlan {
  entry_url?: string
  match?: string
  ready?: string
  wait_until?: string
  settle_ms?: number
  warm?: boolean
}

interface AcquiredPage {
  page: Page
  owned: boolean  // caller must close if true
}

async function acquirePage(
  context: BrowserContext,
  serverUrl: string,
  pagePlan: PagePlan | undefined,
): Promise<AcquiredPage>
```

`acquirePage()` encapsulates:
1. Compute target URL from `entry_url` + `serverUrl`
2. Find existing page matching `match` pattern (or `entry_url` exact path, or origin)
3. If no match: create new page, navigate to target URL with `wait_until`
4. Wait for `ready` condition (CSS selector or networkidle)
5. Sleep `settle_ms` if configured
6. Run `warmSession()` if `warm: true`
7. Return `{ page, owned }`

All three executors call `acquirePage()`:
- **extraction-executor**: `acquirePage()` then dispatch extraction type. Deletes its own `findPageForTarget`, `resolvePageUrl` (page URL part), page creation logic.
- **browser-fetch-executor**: `acquirePage()` then `page.evaluate(fetch(...))`. Deletes its own navigation code.
- **adapter-executor**: `acquirePage()` then `adapter.execute()`. Runtime-provided init replaces adapter `init()` for trivial cases.

The extraction-executor keeps `resolvePageUrl()` for computing the target URL from operation path + params — that's extraction-specific URL construction, not page lifecycle.

---

## Summary of Decisions

| OQ | Decision | New code |
|----|----------|----------|
| 1 | Field-merge precedence (operation over server) | `PagePlan` type + `resolvePagePlan()` |
| 2 | Standard OpenAPI server variables | ~15 lines in `getServerUrl()` |
| 3 | No new primitive. Extend `script_json` with `strip_comments` | ~5 lines |
| 4 | No `dom_list`/`dom_object`. `page_global_data` IS the DOM extraction tool | Zero |
| 5 | Ship helpers and primitives simultaneously | Thin wrappers calling existing resolvers |
| 6 | GraphQL = request field extensions. Capture = new extraction type | `graphql_hash` field + `response_capture` type |
| 7 | Fixed queries + persisted hashes only | Zero — already works |
| 8 | Custom indefinitely. Simple case = `response_capture` | Covered by OQ 6 |
| 9 | Defer mapping DSL. Measure after Phases 1-3 | Zero |
| 10 | 3-phase: defaults → new interface alongside → remove old | Phase 1: runtime defaults only |
| 11 | 13 sites stay custom/deferred. goodrx/booking/costco partially normalizable | Classification table |
| 12 | Publish hard numbers after Phase 0 validation | Zero |
| 13 | `script_json` gets node support. `html_selector` deferred. `page_global_data` never | ~40 lines in node executor |
| 14 | PagePlan replaces all ad-hoc page management. One `acquirePage()` | New `page-plan.ts` module |

Total new concepts: **2** (PagePlan, response_capture). Total new files: **1** (`page-plan.ts`).
Everything else is extensions to existing types and small additions to existing functions.
