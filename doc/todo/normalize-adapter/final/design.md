# Adapter Normalization — Final Design v2

Aligned design with all 14 open questions resolved. Ready for `/eng-plan-review` and `/implement`.

## Goal

Normalize OpenWeb's adapter-heavy sites so more operations run through shared runtime and spec infrastructure, with less per-site code and a smaller permanent custom bucket.

Success means:

- fewer operations using `x-openweb.adapter`
- less per-site adapter TypeScript
- no loss of auth, bot-bypass, or execution reliability
- clearer boundaries between generic runtime behavior and truly site-specific logic

The migration unit is **operation**, not site. A site can become mostly canonical even if a few operations remain custom.

## Current State

- 60 of 93 sites still have custom adapter code
- 33 sites are already canonical
- current wired specs reference adapters on about 380 operations across 58 sites

Most adapter code repeats the same families of work:

- page targeting and readiness
- bot-sensor warming and session preparation
- browser-context request glue
- DOM, SSR, JSON-LD, or response-capture extraction
- GraphQL request assembly
- response unwrapping and light normalization

The main structural problem is not just "missing helpers." It is that the current adapter contract makes each site re-own lifecycle that the runtime should own.

## Design Principles

- KISS. Do not add a generic workflow DSL.
- Reuse existing runtime/spec machinery first: `transport`, auth, CSRF, signing, extraction, `wrap`, and `unwrap`.
- Keep one shared execution model. Do not create parallel systems with different semantics for the same job.
- Track migration per operation, not per site folder.
- Keep a small permanent custom bucket. Some sites should remain custom.
- Prefer staged migration over big-bang rewrites when interface changes are involved.

## Aligned Design

### 1. Move Common Lifecycle Into Shared Runtime

Add runtime-owned page/session lifecycle config so browser-backed operations stop hand-rolling page prep inside adapters.

Use an `x-openweb.page` block at server and/or operation level. Operation fields merge over server fields (same pattern as auth/csrf/signing in `operation-context.ts`):

```yaml
servers:
- url: https://www.example.com
  x-openweb:
    transport: page
    page:
      ready: "#app"
      warm: true
paths:
  /search:
    get:
      x-openweb:
        page:
          entry_url: /search
          ready: ".search-results"
          settle_ms: 500
```

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `entry_url` | string | server URL | Where to navigate before executing |
| `ready` | string | — | CSS selector awaited after navigation |
| `wait_until` | string | `"load"` | Playwright `waitUntil` for navigation (`domcontentloaded` / `load` / `networkidle`) |
| `settle_ms` | number | `0` | Extra delay after `ready` — escape hatch; prefer a tighter `ready` selector |
| `warm` | boolean | `false` | Run `warmSession()` after readiness |
| `nav_timeout_ms` | number | `30000` | Navigation + readiness timeout |

Merge rule: operation fields override server fields field-by-field. Explicit operation values always win, including falsy ones — set `warm: false` at operation level to opt out of a server-level `warm: true`.

Page reuse: the runtime reuses an existing page whose origin matches `serverUrl` and whose current URL starts with `entry_url`; otherwise it navigates. No user-facing `match` knob — if a site needs stricter matching later, add it then.

Non-applicability: PagePlan is ignored when the resolved transport doesn't need a page (`transport: node`). Capture operations always force a fresh navigation (page reuse would race the response listener — the interesting response may already have fired).

This shared lifecycle is used by all browser-backed execution paths: request, extraction, GraphQL, capture, and the custom runner. All three executors (extraction, browser-fetch, adapter) converge on one shared `acquirePage()` function in a new `page-plan.ts` module, replacing the ad-hoc page management currently duplicated across `extraction-executor.ts:32-155`, `browser-fetch-executor.ts`, and `adapter-executor.ts:113-140`.

The unified execution flow for every non-custom operation:

1. Resolve dispatch path from spec: **request** (http/session/browser_fetch by transport), **extraction** (type-based, includes `response_capture`), or **custom** (adapter-backed).
2. `acquirePage()` — resolves PagePlan, navigates to `entry_url`, waits for `ready`, runs `settle_ms`, runs `warmSession()` if configured. Skipped for `transport: node`.
3. Resolve auth, CSRF, signing from spec primitives.
4. Dispatch to the executor chosen in step 1.
5. Apply `unwrap` and schema validation.
6. On failure, classify (`needs_login`, `bot_blocked`, `needs_page`, `fatal`, or retriable).

Only step 4 varies by operation. This is the highest-leverage shared change because it removes most adapter `init()` behavior and a large part of adapter `isAuthenticated()` ownership.

### 2. Fix Shared Request Execution Before Deleting Most API Wrapper Adapters

Pure or near-pure request adapters should only be converted after the shared runtime can express what those adapters currently do.

The first mandatory runtime fixes are:

- request-body parity across `browser_fetch`, `session_http`, and other shared executors (form-encoded bodies)
- page targeting that can open a real app page even when the API origin is different
- one shared path for browser-backed request preparation instead of repeated `page.goto()` and `page.evaluate(fetch(...))` code
- server URL variable substitution (e.g., `{subdomain}.substack.com`) — currently `getServerUrl()` returns the raw string with no variable resolution

This means most "pure spec" conversions depend on those runtime fixes landing first. Multi-subdomain sites (e.g., Substack) are solved by implementing standard OpenAPI server variables — `{subdomain}` placeholders resolved from caller params and `servers[].variables` defaults. No custom extension needed, just ~15 lines in `getServerUrl()`.

**Exception: early conversions.** A small subset of adapters can convert today without waiting for the infrastructure work — specifically, adapters where the server URL is static, the operation only needs JSON POST + existing auth/CSRF primitives, and the existing `browser_fetch` or `session_http` executor already handles the request shape. See Phase 0 for the list. These validate the approach before broader infrastructure lands.

### 3. Shared Extraction: Spec Primitives First, Helpers For The Reduced Custom Bucket

Extraction reuse should extend the existing typed extraction system first. Adapter helpers are still useful where an adapter remains custom and extraction is only one step inside a larger flow, but they should not become the primary normalization path.

Agreed shared extraction additions (spec-level primitives):

- JSON-LD extraction — via `script_json` with `selector: 'script[type="application/ld+json"]'` (no new type needed)
- Generalized SSR hydration — `page_global_data` with `expression: "window.__INITIAL_STATE__"` etc. (already works, no new type needed)
- `strip_comments` option on `script_json` for Yelp-style `<!-- -->` wrapped JSON
- Node execution support for `script_json` (generalize `node-ssr-executor.ts` to handle `script_json` alongside `ssr_next_data`)

No new `dom_list`/`dom_object` primitives. `page_global_data` with JS expressions IS the DOM extraction tool — proven by BBC-News and CNN specs that already use it with `document.querySelectorAll()`. The line: `html_selector` for trivially flat cases (3-5 selectors, all textContent), `page_global_data` for anything with per-field attributes, nesting, or logic.

`page_global_data` remains the bridge and escape hatch for cases that are not yet covered by typed extraction.

**Spec primitives vs adapter helpers serve different use cases.** Spec-level extraction is the default path because it deletes the adapter entirely. Adapter helpers (e.g., `domExtract()`, `ssrExtract()`, `jsonLdExtract()` injected via `AdapterHelpers`) are for the smaller set of operations that still stay custom and need extraction as one step in a larger flow (e.g., extract SSR state, use a value to make an API call, then combine results). Both should share the same field-mapping contract and semantics.

Implementation note: adapter helpers are injected via the `helpers` parameter at runtime (`adapter-executor.ts`), so they run in the runtime process and can reuse the extraction engine directly. No adapter import constraints are violated.

### 4. GraphQL: Extend Request Fields. Capture: New Extraction Type.

GraphQL is request body shaping, not a new execution strategy. Existing fields (`graphql_query`, `wrap`, `unwrap`) already handle fixed inline queries. Add `graphql_hash` for persisted queries:

```yaml
x-openweb:
  graphql_hash: "sha256:abc123..."
  wrap: variables
  unwrap: data.user
```

Transport stays `page` or `node`. No new strategy. Dynamic bundle scanning (LinkedIn) and API-response query-id (X) stay custom — no middle ground exists.

Capture is fundamentally different from request/extraction — it intercepts responses during navigation. Add as new extraction type:

```yaml
x-openweb:
  extraction:
    type: response_capture
    page_url: /flights/search
    match_url: "*/api/search/flights*"
    unwrap: data.results
```

Scope: navigate via PagePlan (always fresh — no page reuse) → register `page.on('response')` handler **before** navigation begins → wait for first response whose URL matches `match_url` → parse JSON → apply `unwrap`. Default timeout is `nav_timeout_ms` from PagePlan. Only the first matching response is returned. Progressive polling, "best of N", and multi-response capture stay custom indefinitely.

The `page_url` field is an alias for PagePlan's `entry_url` for capture operations; if both an `x-openweb.page` block and a `page_url` are set, `page_url` wins (capture-specific override).

### 5. Staged CodeAdapter Migration

Reduce and eventually remove adapter-owned `init()` and `isAuthenticated()` in three steps that map directly onto the Migration Model phases below.

**Step A — Runtime defaults (lands in Migration Phase 1, no interface change):** In `adapter-executor.ts`, before calling `adapter.init()`, the runtime resolves PagePlan from spec, navigates to `entry_url`, waits for `ready`, runs `warmSession()` if configured. Then calls `adapter.init()` — adapters with trivial init (just navigation) can delete it.

For `isAuthenticated()`, the runtime default is "credentials are **configured**" (the declared auth primitive resolves to a cookie/token), not "credentials are **valid**". Sites that currently probe for validity (e.g. adapters that fetch `/me` to check for `login_required`) must keep their `isAuthenticated()` override; the runtime-default path just lets the first real call fail with `needs_login` and surface that. This is an acceptable weakening — the observable contract is "operations that need auth will fail with `needs_login` when auth is missing or invalid" — and it removes a big slice of duplicated adapter code.

Operation-level granularity: the runtime only invokes adapter methods for operations that still reference the adapter. Per-op opt-out uses the existing `x-openweb` merge pattern — operation-level `adapter: false` overrides a server-level `adapter: true`, same as how `transport` overrides today. Migration happens per operation, not per site.

**Step B — New interface alongside old (lands in Migration Phase 5, first half):**
```typescript
interface CustomRunner {
  run(ctx: PreparedContext): Promise<unknown>
}
interface PreparedContext {
  page: Page | null; operation: string; params: Record<string, unknown>
  helpers: AdapterHelpers; auth: AuthResult | undefined; serverUrl: string
}
```
New adapters use `CustomRunner.run()`. Old `CodeAdapter` implementations continue working. The executor dispatches on whichever interface is implemented.

**Step C — Remove old interface (lands in Migration Phase 5, second half):** Migrate remaining adapters to `CustomRunner`. Delete `init()` / `isAuthenticated()` from the contract.

### 6. Keep Response Mapping Minimal — But Define "Minimal"

The first implementation should keep using:

- existing `unwrap` (dot-path extraction)
- extraction field mapping (from typed extraction primitives)
- small site-specific normalization only where still necessary

Do not introduce a broad new response-mapping DSL in the first wave.

However, response mapping is a real gap: roughly 40 adapters do field renaming, type coercion, or array restructuring beyond what `unwrap` provides. For extraction-only sites, `page_global_data` expressions do both extraction AND mapping in one JS expression — no mapping DSL needed. For adapters that stay custom, the adapter code handles mapping. Revisit only after Phases 1-3 reveal whether significant mapping-only adapter code survives.

### 7. Add Guardrails So Normalization Sticks

Add shared reporting and enforcement so new site work does not recreate mini-runtimes.

Guardrails should include:

- an operation-level inventory of adapter usage
- a report of low-level patterns in site code such as `page.goto`, `page.evaluate(fetch`, direct DOM scraping, and response interception
- lint or test checks that keep those patterns out of normalized paths
- doc updates that define the normalization ladder and the permanent custom bucket

## Migration Model

### Quantitative Framing

Starting state:

- ~380 adapter-backed operations across 58 wired sites
- ~18,000 total lines of adapter code
- ~13 sites expected to remain custom (see Permanent Custom Bucket)

Hard per-wave reduction targets are deferred until Phase 0 validates the approach and the operation-level inventory is run (OQ 12). Publishing wave counts now would be cargo-cult planning — the numbers depend on runtime gaps Phase 1 closes.

### Phase 0: Early Conversions (no infrastructure dependency)

A small number of adapters can convert today with spec edits only:

- `zhihu` `cancelUpvote`: POST + CSRF already declared, add `transport: page` at operation level
- `hackernews` read operations: Algolia public API, `transport: node`, no auth
- Any single-operation adapter where the server already declares correct auth/csrf and the operation is a simple GET/POST

These validate the approach and reduce the adapter count immediately.

### Phase 1: Shared Lifecycle And Request Parity

Land the runtime work that pure request adapters actually need:

- page-plan support
- request-body parity
- shared browser-backed request preparation

### Phase 2: Shared Extraction Expansion

Add the agreed extraction improvements:

- `strip_comments` on `script_json` (covers JSON-LD and comment-wrapped JSON)
- Node execution support for `script_json` (generalize `node-ssr-executor.ts`)
- `response_capture` extraction type for simple navigate+intercept patterns
- Adapter extraction helpers (`domExtract`, `ssrExtract`, `jsonLdExtract`) sharing the same resolver code

### Phase 3: Convert The Lowest-Risk Operations First

Start with operations that become canonical immediately once Phase 1 and Phase 2 exist.

Likely early pure-spec candidates after Phase 1:

- `apple-podcasts`
- `fidelity`
- `grubhub`
- `hackernews` read operations
- `seeking-alpha`
- `starbucks`
- `substack`
- `weibo`
- `zhihu`

Likely early extraction candidates after Phase 2:

- `boss`
- `douban`
- `ebay`
- `etsy`
- `goodreads`
- `producthunt`
- `redfin`
- `reuters`
- `rotten-tomatoes`
- `tripadvisor`
- `yelp`
- `indeed`
- `zillow`

Deferred until the extraction path is proven — anti-bot friction or result-type complexity makes these higher risk: `google-search`, and any site that ships captcha or aggressive rate-limit responses.

These lists are intentionally conservative. Disputed sites stay out of the early-wave commitments until they are reclassified per operation.

### Phase 4: Shared GraphQL And Capture For Proven Generic Cases

After the shared lifecycle and extraction work, migrate only the GraphQL and capture operations that fit the narrow generic patterns described above.

### Phase 5: Cut Down The Remaining Custom Bucket

Once the shared runtime owns lifecycle and the low-risk shared strategies are working, shrink the remaining custom interface and leave only the genuinely site-specific cases.

## Permanent Custom Bucket

Per OQ 11, these 13 sites are custom and excluded from Phases 0-3:

Confirmed irreducible — bespoke signers, proprietary modules, or binary protocols:

- `bilibili` — Wbi/MD5 signing, protobuf danmaku, CSRF via cookie
- `notion` — transaction-based mutation protocol
- `opentable` — webpack module access, signing
- `telegram` — webpack module scanning, getGlobal state reader
- `tiktok` — network intercept + signing + progressive capture
- `whatsapp` — Meta's Metro module system
- `x` — dynamic queryId + transaction-id signing + webpack modules

Resolved to custom by OQ 11 — multi-step composition, dynamic scraping countermeasures, or non-HTTP protocols:

- `instagram` — multi-step API composition (username→userId→feed), auth guard
- `bluesky` — ATP/XRPC protocol, dynamic PDS URL discovery
- `youtube` — InnerTube API + sapisidhash + protobuf continuation params
- `linkedin` — dynamic queryId extraction from JS bundles
- `spotify` — dynamic bearer token extraction + pathfinder GQL
- `google-maps` — protobuf pb param API, network intercept

Partially normalizable — some operations migrate, others stay custom (per-operation split in Phase 3-4):

- `booking` — LD+JSON ops → `script_json`; Apollo SSR + GQL intercept ops stay custom
- `costco` — simple POST ops → spec after request parity; complex multi-step ops stay custom
- `goodrx` — once PagePlan + warm + extraction land, most ops can normalize

These are not failures of the design. They define the reasonable boundary of the shared system.

## Non-Goals For The First Implementation

- a generic workflow DSL
- a big-bang rewrite of every adapter interface at once
- forcing every GraphQL or capture site into declarative config
- a broad response-mapping DSL
- eliminating the permanent custom bucket

## Verification

The implementation plan should verify at least:

- page-targeting and readiness behavior when the app page differs from the API origin
- request-body parity between shared executors, including form-encoded bodies
- auth, CSRF, signing, warmup, and failure classification after lifecycle moves into runtime
- JSON-LD, SSR hydration, and HTML-source extraction (via `script_json` + `page_global_data`)
- `response_capture` listener registered before navigation (no race on fast responses)
- operation-level split migrations where read ops move first and write ops remain custom
- guardrails that prevent normalized paths from reintroducing low-level per-site runtime code

## Open Questions — All Resolved

All 14 open questions have been resolved. See [open-questions-resolved.md](open-questions-resolved.md) for the full analysis with codebase evidence.

Key decisions:
1. PagePlan: field-merge precedence (operation over server), new `page-plan.ts` module with `acquirePage()`
2. Multi-subdomain: standard OpenAPI server variables, ~15 lines in `getServerUrl()`
3. SSR: no new primitive — extend `script_json` with `strip_comments`, use `page_global_data` for framework-specific SSR
4. DOM: no `dom_list`/`dom_object` — `page_global_data` IS the DOM extraction tool (proven by BBC-News, CNN)
5. Helpers: ship alongside spec primitives (they share code, serve non-overlapping cases)
6. GraphQL: `graphql_hash` field for persisted queries. Capture: `response_capture` extraction type
7. GraphQL patterns: fixed + persisted only, no middle ground
8. Progressive capture: custom indefinitely
9. Response mapping: defer, measure after Phases 1-3
10. CodeAdapter: 3-phase migration (runtime defaults → new interface alongside → remove old)
11. Disputed sites: 13 stay custom/deferred; goodrx/booking/costco partially normalizable
12. Hard counts: after Phase 0 validation
13. Node extraction: `script_json` gets node support; `html_selector` deferred; `page_global_data` never
14. PagePlan replaces all ad-hoc page management across 3 executors
