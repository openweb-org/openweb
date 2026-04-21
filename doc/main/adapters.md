# L3 Custom Runners

> CustomRunner interface, loading, and execution lifecycle for sites that defy declarative modeling.
> Last updated: 2026-04-21 (PreparedContext + validation/runtime boundary sync)

## Overview

L3 custom runners are the escape hatch. When a site's internal API is too complex for L2 primitives — proprietary module systems, custom signing, non-HTTP protocols — you write a `CustomRunner`: arbitrary JS that runs in Node and can drive a live Patchright page when the operation needs a browser.

The runtime does the common lifecycle work **before** the runner is invoked: page acquisition and readiness (PagePlan → `acquirePage`), bot-sensor warming, server-URL interpolation, and optional auth resolution into `ctx.auth`. The runner gets a `PreparedContext` and owns the site-specific request/data acquisition logic.

Keep runners narrowly scoped. The injected helper surface arrives via `ctx.helpers`; the stable direct-import exceptions are helper-library utilities such as `nodeFetch` and `interceptResponse` from `src/lib/adapter-helpers.ts`, which are bundled into the emitted adapter `.js` at build time.

-> See: `src/runtime/adapter-executor.ts`, `src/types/adapter.ts`

---

## CustomRunner Interface

```typescript
interface CustomRunner {
  readonly name: string
  readonly description: string
  run(ctx: PreparedContext): Promise<unknown>
  /** Optional per-site readiness predicate. The runtime polls this during
   *  warm-up (after navigation, before run()) until it returns true or
   *  `warmTimeoutMs` elapses. Use for SPAs whose hydration the runtime
   *  can't detect via cookies (Telegram webpack chunks + Worker entity
   *  cache, IndexedDB-backed session). Errors are swallowed — warm-up is
   *  best-effort. */
  warmReady?(page: Page): Promise<boolean>
  /** Max time to poll `warmReady` (default 15000ms). */
  warmTimeoutMs?: number
}

interface PreparedContext {
  page: Page | null                // null for transport: node
  operation: string                // operationId from the OpenAPI spec
  params: Record<string, unknown>  // validated caller input
  helpers: AdapterHelpers          // pageFetch, graphqlFetch, ssrExtract, jsonLdExtract, domExtract, errors
  auth: AuthResult | undefined     // pre-resolved from spec auth primitive
  serverUrl: string                // already interpolated with server variables
}

interface AdapterHelpers {
  pageFetch(page: Page, options: PageFetchOptions): Promise<PageFetchResult>
  graphqlFetch(page: Page, options: GraphqlFetchOptions): Promise<unknown>
  ssrExtract(page: Page, source: string, path?: string): Promise<unknown>
  jsonLdExtract(page: Page, typeFilter?: string): Promise<unknown[]>
  domExtract(
    page: Page,
    spec: DomExtractSpec,
  ): Promise<Record<string, string | null> | Array<Record<string, string | null>>>
  errors: AdapterErrorHelpers      // unknownOp, missingParam, httpError, needsLogin, fatal, retriable, etc.
}
```

Note: `nodeFetch` and `interceptResponse` are exported from `src/lib/adapter-helpers.ts` but are **not** injected into `ctx.helpers` — only the six members above are available on the runner context.

The runner is a **single function**. There is no separate `init()` or `isAuthenticated()` — the runtime handles both:
- Navigation + readiness comes from `x-openweb.page_plan` on the operation (-> See: `primitives/page-plan.md`).
- Auth validity comes from the declared auth primitive. If the primitive resolves to a token/cookie, `ctx.auth` is populated; if the call then fails server-side, surface it as `throw helpers.errors.needsLogin()`.

-> See: `src/types/adapter.ts`, `src/lib/adapter-helpers.ts`

---

## Execution Lifecycle

```
┌─────────────────────┐
│ acquirePage         │  Nav + ready + settle + warm (PagePlan)
│  (skipped if node)  │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ resolveAuth         │  From spec primitive; ctx.auth populated if it resolves
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ runner.run(ctx)     │  Site-specific work only
└──────────┬──────────┘
           │
           ▼
 Result (still passes through auth_check + response-schema validation)
```

Key properties:
- Page is `null` when transport is `node` — runner must do its own HTTP (e.g. global `fetch`); `nodeFetch` is not on `ctx.helpers`.
- PagePlan settings (entry_url / ready / warm / nav_timeout_ms) run before the runner. Trivial URL checks and simple cookie probes that used to live in `init()`/`isAuthenticated()` are gone.
- `ctx.auth` is the only request material pre-resolved into `PreparedContext`. Server-level CSRF/signing config is not injected into adapter ops automatically.
- Runner output still goes through the shared post-dispatch path: `auth_check`, response parsing, unwrap, and response-schema validation all still apply after `run(ctx)` returns.
- Runners are cached by `siteRoot:runnerName`.

---

## How Custom Runners Are Referenced

In the OpenAPI spec, an operation (or server) points to a custom runner via `x-openweb.adapter`:

```yaml
paths:
  /getChats:
    get:
      operationId: getChats
      x-openweb:
        adapter:
          name: whatsapp
          operation: getChats
          params:
            limit: 50
```

For spec-only operations on a site that otherwise uses a runner, opt out explicitly:

```yaml
paths:
  /search:
    get:
      operationId: searchThings
      x-openweb:
        adapter: false          # this op is spec-only; runtime skips the runner
```

The runtime loads `adapters/<runner-name>.js` from the site package.

---

## Real Runner Examples

### WhatsApp (Meta require() module system)

WAWeb uses Meta's custom module system (`__d` / `__w` / `require`). The runner walks it to reach internal chat data. Per-call `ensureReady` (Metro module-wait + chat collection probe) is inlined at the top of `run()`.

-> See: `src/sites/whatsapp/adapters/whatsapp-modules.ts`

### Telegram (teact global state)

Telegram Web uses teact with a global state store. The runner finds `getGlobal()` via webpack chunk walking. Multi-login conflict detection is inlined in `run()` preamble.

-> See: `src/sites/telegram/adapters/telegram-protocol.ts`

### TikTok (signed fetch)

Patches `window.fetch` with X-Bogus / X-Gnarly / msToken / ztca-dpop signing. Read intercepts go through the patched fetch.

-> See: `src/sites/tiktok/adapters/tiktok-web.ts`

---

## When to Use L3

Use L3 when the site has at least one of:
- **Proprietary module system** (Meta require, custom AMD, webpack cache walking)
- **Custom signing/crypto** (Wbi, SAPISIDHASH, X-Bogus, Pathfinder bearer extraction)
- **Non-HTTP protocols** (ATP/XRPC, custom WebSocket)
- **Binary/protobuf formats** (bilibili danmaku, google-maps pb params)
- **Dynamic query-id scraping** (LinkedIn, X)

### Anti-patterns — what NOT to put in a runner

Three patterns look like they need runners but don't. Use the stated alternative instead:

1. **Chaining two calls** (e.g. `getUserPosts(username)` internally calling `getUserProfile` then `getUserFeed`). Expose the two ops separately and document the workflow in SKILL.md. Agents compose.
2. **Response reshaping for aesthetics** (renaming wire fields, composing nested objects, flattening arrays). The response schema should describe the wire shape; SKILL.md explains semantics. Runtime does not reshape.
3. **Simple page navigation + fetch** (open page, call API, return JSON). Use `transport: page` + `x-openweb.page_plan` + declared auth/csrf primitives. No runner needed.

If your runner would only do one of these, it shouldn't exist — convert the site to spec instead. Permanent-custom-bucket sites (`bilibili`, `notion`, `opentable`, `telegram`, `tiktok`, `whatsapp`, `x`, `instagram`, `bluesky`, `youtube`, `linkedin`, `spotify`, `google-maps`, `glassdoor`, `trello`, `tripadvisor`) are custom because they hit the legitimate criteria above, not because of the anti-patterns.

---

## Runner Loading

```typescript
loadAdapter(siteRoot: string, runnerName: string): CustomRunner
```

1. Validate runner name (no `/`, `..`, or path traversal)
2. Resolve path: `{siteRoot}/adapters/{runnerName}.js` (or `.ts` at build time)
3. Dynamic import with cache
4. Validate export shape — must have `name` and `run`

---

## File Structure

```
src/runtime/
├── adapter-executor.ts       # loadAdapter, executeAdapter, clearAdapterCache
├── page-plan.ts              # acquirePage — PagePlan-driven navigation/readiness
└── response-unwrap.ts        # applyResponseUnwrap (used by all HTTP executors)

src/lib/
└── adapter-helpers.ts        # pageFetch, graphqlFetch, ssrExtract, jsonLdExtract, domExtract
                              # (also exports nodeFetch + interceptResponse, but these are NOT injected into ctx.helpers)

src/types/
└── adapter.ts                # CustomRunner, PreparedContext, AdapterHelpers, AuthResult

src/sites/
├── whatsapp/adapters/whatsapp-modules.ts
├── telegram/adapters/telegram-protocol.ts
├── tiktok/adapters/tiktok-web.ts
└── …                         # 15 sites in the permanent custom bucket
```

---

## Related Docs

- [architecture.md](architecture.md) — Where L3 fits in the 3-layer model
- [runtime.md](runtime.md) — Full execution pipeline including PagePlan + auth resolution
- [primitives/page-plan.md](primitives/page-plan.md) — PagePlan fields + merge semantics
- [primitives/README.md](primitives/README.md) — L2 alternatives when a runner isn't needed
- `src/types/adapter.ts` — CustomRunner type definition
- `doc/todo/normalize-adapter/impl_summary.md` — why the interface changed from CodeAdapter → CustomRunner
