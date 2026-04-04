# L3 Adapter Framework

> CodeAdapter interface, loading, and execution lifecycle for sites that defy declarative modeling.
> Last updated: 2026-03-26 (M38)

## Overview

L3 adapters are the escape hatch. When a site's internal API is too complex for L2 primitives — proprietary module systems, custom serialization, non-HTTP protocols — you write a CodeAdapter: arbitrary JS that runs in the browser via Patchright (Playwright fork with CDP detection bypass).

~7% of sites need L3 (validated against 103 OpenTabs plugins).

-> See: `src/runtime/adapter-executor.ts`

---

## CodeAdapter Interface

```typescript
interface CodeAdapter {
  name: string
  description: string

  init(page: Page): Promise<boolean>
  isAuthenticated(page: Page): Promise<boolean>
  execute(page: Page, operation: string, params: Record<string, unknown>): Promise<unknown>
}
```

-> See: `src/types/adapter.ts`

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
└── adapter-executor.ts       # loadAdapter, executeAdapter, clearAdapterCache

src/types/
└── adapter.ts                # CodeAdapter interface

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
