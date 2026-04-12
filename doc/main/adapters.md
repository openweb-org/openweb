# L3 Adapter Framework

> CodeAdapter interface, loading, and execution lifecycle for sites that defy declarative modeling.
> Last updated: 2026-04-12 (infrastructure improvements — interceptResponse, nodeFetch, Page|null path)

## Overview

L3 adapters are the escape hatch. When a site's internal API is too complex for L2 primitives — proprietary module systems, custom serialization, non-HTTP protocols — you write a CodeAdapter: arbitrary JS that runs in the browser via Patchright (Playwright fork with CDP detection bypass), or in Node.js for sites that don't need a browser.

Adapters must be **self-contained** — they cannot import from `src/`. After packaging, adapters load from the compile cache (`$OPENWEB_HOME/sites/<site>/adapters/`), where relative imports break. Shared utilities (`pageFetch`, `graphqlFetch`, `interceptResponse`, error factories) are injected by the runtime via the `execute()` 4th parameter. For node-transport adapters, import `nodeFetch` directly from `src/lib/adapter-helpers.ts`.

-> See: `src/runtime/adapter-executor.ts`

---

## CodeAdapter Interface

```typescript
interface AdapterHelpers {
  pageFetch(page: Page, options: PageFetchOptions): Promise<PageFetchResult>
  graphqlFetch(page: Page, options: GraphqlFetchOptions): Promise<unknown>
  errors: AdapterErrorHelpers  // unknownOp, missingParam, httpError, apiError, fatal, retriable, etc.
}

interface CodeAdapter {
  readonly name: string
  readonly description: string

  init(page: Page | null): Promise<boolean>
  isAuthenticated(page: Page | null): Promise<boolean>
  execute(page: Page | null, operation: string, params: Readonly<Record<string, unknown>>, helpers: AdapterHelpers): Promise<unknown>
}
```

When `page` is `null`, the adapter is running in node transport mode — no browser is available. The adapter must use `nodeFetch()` (imported directly) instead of `pageFetch`/`graphqlFetch` (which require a Page).

-> See: `src/types/adapter.ts`, `src/lib/adapter-helpers.ts`

---

## Execution Lifecycle

```
┌─────────────┐
│ loadAdapter  │  Load .js or .ts from adapters/ directory
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    init()    │  Initialize adapter (setup hooks, validate page state)
└──────┬──────┘
       │ returns boolean (success)
       ▼
┌─────────────────┐
│isAuthenticated() │  Check if user is logged in
└──────┬──────────┘
       │ returns boolean
       ▼
┌─────────────┐
│  execute()   │  Run the operation with params
└──────┬──────┘
       │ returns arbitrary result
       ▼
   Result (unvalidated)
```

**Key properties:**
- When `page` is non-null: full browser lifecycle (polyfills, warmSession, bot detection)
- When `page` is null (transport: node): adapter runs without browser — `init()`, `isAuthenticated()`, `warmSession()`, and `detectPageBotBlock()` are all skipped
- Adapter result is **not validated** against response schema (unlike L1/L2)
- Adapters are **cached** by `siteRoot:adapterName` (cleared via `clearAdapterCache()`)
- Adapter name is validated against path traversal

---

## How Adapters Are Referenced

In the OpenAPI spec, an operation points to an adapter via `x-openweb.adapter`:

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

The runtime loads `adapters/whatsapp.js` from the skill package directory.

---

## Real Adapter Examples

### WhatsApp (Meta require() module system)

WhatsApp Web uses Meta's custom module system (`__d` / `__w` / `require`). The adapter walks this system to access internal data stores.

```
adapters/whatsapp-modules.ts
  init()     → Verify WAWebBuildConstants exists
  isAuth()   → Check window.__debug?.phone?.info exists
  execute()  → require("WAWebChatCollection") → getModelsArray()
```

-> See: `src/sites/whatsapp/adapters/whatsapp-modules.ts`

### Telegram (teact global state)

Telegram Web uses the teact framework with a global state store. The adapter discovers the state accessor via webpack module walking.

```
adapters/telegram-protocol.ts
  init()     → Find getGlobal() via webpack chunk walk
  isAuth()   → getGlobal().authState === 'authorizationStateReady'
  execute()  → getGlobal().chats.byId → transform to output
```

-> See: `src/sites/telegram/adapters/telegram-protocol.ts`

---

## Adapter Loading

```typescript
loadAdapter(siteRoot: string, adapterName: string): CodeAdapter
```

1. Validate adapter name (no `/`, `..`, or path traversal)
2. Resolve path: `{siteRoot}/adapters/{adapterName}.js` (or `.ts` at build time)
3. Dynamic import with cache
4. Validate export shape (must have `name`, `init`, `isAuthenticated`, `execute`)

---

## When to Use L3

Use L3 when the site:
- Has a **proprietary module system** (Meta require, custom AMD)
- Requires **non-HTTP protocols** (custom binary WebSocket)
- Needs **complex page interaction** (multi-step flows, dynamic discovery)
- Has **internal state** not accessible via standard APIs

If the site has a normal REST/GraphQL API with standard auth, L2 primitives should suffice.

---

## File Structure

```
src/runtime/
├── adapter-executor.ts       # loadAdapter, executeAdapter, clearAdapterCache
└── response-unwrap.ts        # applyResponseUnwrap (used by all HTTP executors)

src/lib/
└── adapter-helpers.ts        # pageFetch, graphqlFetch, interceptResponse, nodeFetch

src/types/
└── adapter.ts                # CodeAdapter, AdapterHelpers, AdapterErrorHelpers

src/sites/
├── whatsapp/
│   └── adapters/whatsapp-modules.ts  # Meta require() adapter
└── telegram/
    └── adapters/telegram-protocol.ts  # teact global state adapter
```

---

## Related Docs

- [architecture.md](architecture.md) — Where L3 fits in the 3-layer model
- [runtime.md](runtime.md) — How adapter execution is dispatched
- [primitives/](primitives/README.md) — L2 alternative when adapters aren't needed
- `src/types/adapter.ts` — CodeAdapter type definition
