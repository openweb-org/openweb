# Layer 3: Code Adapters — Escape Hatch

> **Status**: DRAFT
> **Addresses**: Gaps 003, 004, 007, 009, 011
> **Principle**: Structure is the default, code is the exception.

## When L3 is Needed

L3 code adapters handle the ~7% of sites where L2 primitives are insufficient:

| Reason | Sites | Gap |
|---|---|---|
| Obfuscated request signing | OnlyFans, TikTok, minimax-agent | 004 |
| Internal non-HTTP protocol | WhatsApp, Telegram | 007 |
| Persisted query hash extraction from webpack | Instacart | 009 |
| Custom module system for auth tokens | Facebook (`fbRequire`) | 002 |

**Decision rule**: If the behavior can be expressed as `extract(source, config) → inject(target)`,
it's L2. If it requires arbitrary computation, module access, or protocol translation, it's L3.

---

## Adapter Interface

Every L3 adapter is a TypeScript module that exports a `CodeAdapter` object.
It runs in browser page context via `page.evaluate()`.

```typescript
// @openweb/runtime types

interface CodeAdapter {
  /** Unique identifier for this adapter */
  name: string;

  /** Human-readable description */
  description: string;

  /** What this adapter provides */
  provides: AdapterCapability[];

  /**
   * Initialize the adapter. Called once when the skill is loaded.
   * Use for: webpack module discovery, manager access, collection setup.
   * Returns false if the adapter can't function (e.g., site not loaded).
   */
  init(page: Page): Promise<boolean>;

  /**
   * Check if the user is authenticated.
   * Called before tool execution.
   */
  isAuthenticated(page: Page): Promise<boolean>;

  /**
   * Execute an adapter function by name.
   * The runtime calls this for operations that need L3 logic.
   */
  execute(page: Page, operation: string, params: Record<string, unknown>): Promise<unknown>;
}

type AdapterCapability =
  | { type: 'signing'; description: string }      // request signing
  | { type: 'auth'; description: string }          // auth token extraction
  | { type: 'protocol'; description: string }      // non-HTTP protocol access
  | { type: 'extraction'; description: string };   // data extraction from internals
```

### Execution Model

The adapter's `execute()` runs inside `page.evaluate()`:

```typescript
// Runtime executor calls adapter like this:
async function executeL3(
  page: Page,
  adapter: CodeAdapter,
  operation: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  // 1. Ensure initialized
  if (!await adapter.init(page)) {
    throw new Error(`Adapter ${adapter.name} failed to initialize`);
  }

  // 2. Check auth
  if (!await adapter.isAuthenticated(page)) {
    throw new ToolError('auth', 'Not authenticated');
  }

  // 3. Execute operation
  return adapter.execute(page, operation, params);
}
```

### Error Contract

Adapters throw structured errors matching the runtime's error taxonomy:

```typescript
type ToolErrorCode = 'auth' | 'not_found' | 'rate_limited' | 'validation' | 'internal';

class ToolError extends Error {
  constructor(
    public code: ToolErrorCode,
    message: string,
    public retryable: boolean = false,
  ) {
    super(message);
  }
}
```

---

## Real Adapter Examples

### OnlyFans — Obfuscated Request Signing (Gap 004)

OnlyFans uses webpack module `977434` which exports a `JA` function that
generates cryptographic request headers. The signing algorithm is obfuscated
and changes with each deployment — it cannot be reimplemented.

```typescript
// adapters/onlyfans-signing.ts
import type { CodeAdapter, Page } from '@openweb/runtime';

let headerBuilder: ((config: { url: string }) => Record<string, string>) | null = null;

export default {
  name: 'onlyfans-signing',
  description: 'Request signing via obfuscated webpack module',
  provides: [{ type: 'signing', description: 'Generates sign/time/x-bc/x-hash headers' }],

  async init(page: Page): Promise<boolean> {
    headerBuilder = await page.evaluate(() => {
      const chunks = (window as any).webpackChunkof_vue;
      if (!chunks) return null;

      let builder: any = null;
      const id = `openweb_${Date.now()}`;
      chunks.push([
        [id],
        { [id]: (_m: any, _e: any, require: any) => { builder = require('977434')?.JA; } },
        (require: any) => { require(id); },
      ]);
      return typeof builder === 'function' ? builder : null;
    });
    return headerBuilder !== null;
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      const store = (window as any).__vue_app__?.config?.globalProperties?.$store;
      return !!store?.getters?.['auth/authUserId'];
    });
  },

  async execute(page: Page, operation: string, params: Record<string, unknown>) {
    if (operation === 'signRequest') {
      const url = params.url as string;
      return page.evaluate(
        ([url]) => {
          // headerBuilder is captured in page closure from init
          const builder = (window as any).__openweb_headerBuilder;
          if (!builder) throw new Error('Header builder not initialized');
          return builder({ url });
        },
        [url],
      );
      // Returns: { sign: '...', time: '...', 'app-token': '...', 'x-bc': '...', 'x-hash': '...' }
    }
    throw new Error(`Unknown operation: ${operation}`);
  },
} satisfies CodeAdapter;
```

**How this replaces the OpenTabs plugin**: The plugin's `waRequire('977434').JA`
pattern is captured in `init()`. The runtime calls `execute('signRequest', { url })`
before each API call, then merges the returned headers into the request.

### TikTok — Dynamic URL Signing (Gap 004)

TikTok uses `byted_acrawler.frontierSign(url)` to generate an `X-Bogus`
parameter. The signing function is loaded as a global by TikTok's JS bundle.

```typescript
// adapters/tiktok-signing.ts
import type { CodeAdapter, Page } from '@openweb/runtime';

export default {
  name: 'tiktok-signing',
  description: 'X-Bogus URL signing via byted_acrawler',
  provides: [{ type: 'signing', description: 'Generates X-Bogus query parameter' }],

  async init(page: Page): Promise<boolean> {
    return page.evaluate(() =>
      typeof (window as any).byted_acrawler?.frontierSign === 'function',
    );
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      const script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (!script) return false;
      const data = JSON.parse(script.textContent ?? '{}');
      return !!data.__DEFAULT_SCOPE__?.['webapp.app-context']?.user?.uid;
    });
  },

  async execute(page: Page, operation: string, params: Record<string, unknown>) {
    if (operation === 'signUrl') {
      const url = params.url as string;
      return page.evaluate(async ([url]) => {
        const result = await (window as any).byted_acrawler.frontierSign(url);
        const xBogus = result['X-Bogus'];
        if (!xBogus) throw new Error('Signing failed: no X-Bogus returned');
        return url.includes('?') ? `${url}&X-Bogus=${xBogus}` : `${url}?X-Bogus=${xBogus}`;
      }, [url]);
    }
    throw new Error(`Unknown operation: ${operation}`);
  },
} satisfies CodeAdapter;
```

### Telegram — Internal MTProto Protocol (Gap 007)

Telegram Web uses an internal API manager that communicates via Web Workers
using the MTProto protocol. There is no HTTP REST API — all data flows
through `rootScope.managers.apiManager.invokeApi()`.

```typescript
// adapters/telegram-protocol.ts
import type { CodeAdapter, Page } from '@openweb/runtime';

export default {
  name: 'telegram-protocol',
  description: 'MTProto API access via internal apiManager',
  provides: [{ type: 'protocol', description: 'TL method invocation via Web Worker' }],

  async init(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      const rs = (window as any).rootScope;
      return typeof rs?.managers?.apiManager?.invokeApi === 'function';
    });
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    return page.evaluate(() => !!(window as any).rootScope?.myId);
  },

  async execute(page: Page, operation: string, params: Record<string, unknown>) {
    // operation = TL method name (e.g., 'messages.getDialogs')
    return page.evaluate(
      async ([method, params]) => {
        const rs = (window as any).rootScope;
        const result = await rs.managers.apiManager.invokeApi(method, params);
        // Serialize TLObject (strip circular refs, resolve getters)
        return JSON.parse(JSON.stringify(result));
      },
      [operation, params],
    );
  },
} satisfies CodeAdapter;
```

**Operations mapping** (OpenTabs plugin tools → adapter calls):

| Tool | Adapter call |
|---|---|
| `getDialogs` | `execute(page, 'messages.getDialogs', { offset_date: 0, limit: 100 })` |
| `sendMessage` | `execute(page, 'messages.sendMessage', { peer, message })` |
| `getMessages` | `execute(page, 'messages.getHistory', { peer, limit })` |
| `getUserInfo` | `callManager('appUsersManager', 'getUserInput', userId)` |

### WhatsApp — Internal Module System (Gap 007)

WhatsApp Web has no REST/GraphQL API. All data lives in in-memory collections
accessed via Facebook's `require()` module system. Message sending uses DOM
manipulation (paste + Enter) because there is no programmatic send API.

```typescript
// adapters/whatsapp-modules.ts
import type { CodeAdapter, Page } from '@openweb/runtime';

export default {
  name: 'whatsapp-modules',
  description: 'WhatsApp Web internal module access + UI automation',
  provides: [
    { type: 'protocol', description: 'Internal collections via require()' },
    { type: 'extraction', description: 'Chat/contact/message serialization' },
  ],

  async init(page: Page): Promise<boolean> {
    return page.evaluate(() =>
      typeof (window as any).require === 'function',
    );
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      try {
        const col = (window as any).require('WAWebChatCollection')?.ChatCollection;
        return (col?.getModelsArray()?.length ?? 0) > 0;
      } catch { return false; }
    });
  },

  async execute(page: Page, operation: string, params: Record<string, unknown>) {
    switch (operation) {
      case 'getChats':
        return page.evaluate(() => {
          const col = (window as any).require('WAWebChatCollection').ChatCollection;
          return col.getModelsArray().map((c: any) => ({
            id: c.id._serialized,
            name: c.name ?? c.formattedTitle,
            isGroup: c.isGroup,
            unreadCount: c.unreadCount,
            timestamp: c.t,
          }));
        });

      case 'getMessages':
        return page.evaluate(([chatId, limit]) => {
          const col = (window as any).require('WAWebChatCollection').ChatCollection;
          const chat = col.getModelsArray().find((c: any) => c.id._serialized === chatId);
          if (!chat) throw new Error(`Chat not found: ${chatId}`);
          return chat.msgs.getModelsArray().slice(-(limit as number)).map((m: any) => ({
            id: m.id._serialized,
            fromMe: m.id.fromMe,
            body: m.body,
            timestamp: m.t,
            type: m.type,
          }));
        }, [params.chatId, params.limit ?? 50]);

      case 'sendMessage':
        // UI automation: open chat, paste text, press Enter
        await page.evaluate(([chatId]) => {
          const col = (window as any).require('WAWebChatCollection').ChatCollection;
          const chat = col.getModelsArray().find((c: any) => c.id._serialized === chatId);
          if (!chat) throw new Error(`Chat not found: ${chatId}`);
          (window as any).require('WAWebCmd').Cmd.openChatBottom({ chat });
        }, [params.chatId]);

        // Wait for compose box, paste text, press Enter
        const compose = await page.waitForSelector(
          '[data-tab="10"][contenteditable="true"]',
          { timeout: 5000 },
        );
        await compose.focus();
        await page.keyboard.insertText(params.text as string);
        await page.keyboard.press('Enter');
        return { sent: true };

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  },
} satisfies CodeAdapter;
```

### Instacart — Persisted Query Hash Extraction (Gap 009)

Instacart's GraphQL uses Apollo persisted queries. Hashes are compiled into
webpack module `47096` and change on every deployment.

```typescript
// adapters/instacart-hashes.ts
import type { CodeAdapter, Page } from '@openweb/runtime';

const FALLBACK_HASHES: Record<string, string> = {
  CurrentUser: '4dadd77c2be35e01a3e199e04f3ece27c9beedadb6495b87c7c814c5c176e05c',
  PersonalActiveCarts: 'eac9d17bd45b099fbbdabca2e111acaf2a4fa486f2ce5bc4e8acbab2f31fd8c0',
  CartData: 'febb10bfcc2ba31eec79ad3f2bd7ef1e1a7d2d893b4f212ff438188bb5c1d359',
};

export default {
  name: 'instacart-hashes',
  description: 'Persisted query hash extraction from webpack',
  provides: [{ type: 'extraction', description: 'GraphQL operation hashes from module 47096' }],

  async init(page: Page): Promise<boolean> {
    return page.evaluate(() => !!(window as any).webpackChunk);
  },

  async isAuthenticated(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      try {
        const cache = (window as any).__APOLLO_CLIENT__?.cache?.extract();
        const user = cache?.['SharedCurrentUser:{}']?.currentUser;
        return !!user?.id && !user?.guest;
      } catch { return false; }
    });
  },

  async execute(page: Page, operation: string, params: Record<string, unknown>) {
    if (operation === 'getHash') {
      const opName = params.operationName as string;
      const hash = await page.evaluate(([opName]) => {
        const chunks = (window as any).webpackChunk;
        for (const chunk of chunks) {
          const modules = chunk[1];
          if (modules?.['47096']) {
            const fakeModule: any = { exports: null };
            modules['47096'](fakeModule);
            return fakeModule.exports?.[opName] ?? null;
          }
        }
        return null;
      }, [opName]);

      return hash ?? FALLBACK_HASHES[opName] ?? null;
    }
    throw new Error(`Unknown operation: ${operation}`);
  },
} satisfies CodeAdapter;
```

---

## How L3 Integrates with L2

An endpoint can use **both** L2 primitives and L3 adapters. The runtime
composes them in order:

```
1. L2 auth      → extract token, inject header
2. L2 csrf      → extract CSRF, inject header
3. L3 signing   → compute signature, inject headers  ← adapter
4. HTTP request
5. L2 pagination → handle cursor/offset
```

In the OpenAPI spec, an operation references its L3 adapter:

```yaml
paths:
  /api2/v2/users/{userId}:
    get:
      operationId: getUser
      x-openweb:
        risk_tier: low
        adapter:
          name: onlyfans-signing
          operation: signRequest
          params:
            url: "{request.url}"   # template: resolved at runtime
```

For pure-L3 operations (no HTTP API, like WhatsApp):

```yaml
paths:
  /internal/chats:
    get:
      operationId: getChats
      x-openweb:
        mode: browser_fetch
        risk_tier: safe
        adapter:
          name: whatsapp-modules
          operation: getChats
```

---

## Package Layout

L3 adapters live in the `adapters/` directory of a skill package:

```
whatsapp/
├── manifest.json
├── openapi.yaml          # L1 + L2 + adapter references
├── adapters/
│   └── whatsapp-modules.ts
└── tests/
    └── smoke.test.ts
```

See [skill-package-format.md](skill-package-format.md) for full layout.

---

## Security Model

### Execution Boundary

L3 adapters run in the **browser page context** — same origin, same permissions
as the website's own JavaScript. They cannot:
- Access other tabs or origins
- Read filesystem or Node.js APIs
- Escape the browser sandbox

### Trust Model

L3 adapters are **authored code** (written by humans or generated by the compiler
with human review). They are NOT auto-generated from capture — the compiler
only emits stubs that flag "this endpoint needs L3."

Trust chain: `human author → code review → skill package → runtime executes`

### Risk Classification

All L3 operations inherit the standard risk classification from
[compiler-pipeline.md](compiler-pipeline.md). Additionally:

- L3 adapters that perform **write operations** (send message, delete, etc.)
  must be marked `risk_tier: high` or above.
- L3 adapters that access **internal module state** (collections, caches) are
  read-only safe but marked `risk_tier: low` for data sensitivity.

### No Dynamic Code Loading

Adapters must be static TypeScript files in the package. The runtime does NOT:
- `eval()` arbitrary strings from the network
- Load adapters from external URLs
- Allow adapters to modify other adapters

---

## Compiler L2 vs L3 Decision

The compiler classifies an endpoint as L3 when:

1. **Signing pattern detected but algorithm unknown**: Header values change
   per-request, crypto functions found in webpack, but no known algorithm
   (SAPISIDHASH, SigV4) matches.
2. **No HTTP API traffic**: The feature works in the browser but produces no
   XHR/fetch calls in the HAR (WhatsApp, Telegram).
3. **Persisted query hashes in webpack**: GraphQL requests use hashes that
   are embedded in bundled modules, not extractable via simple globals.
4. **Custom module system**: `require()` or `fbRequire()` needed for
   auth/data access, not expressible as `page_global` extraction.

The compiler emits a stub adapter with TODO comments. A human or LLM fills
in the implementation using the captured behavior as reference.

---

## Cross-References

- **L2 primitives** → [layer2-interaction-primitives.md](layer2-interaction-primitives.md): L3 supplements, not replaces, L2
- **Runtime executor** → [runtime-executor.md](runtime-executor.md): How L3 adapters are called
- **Browser integration** → [browser-integration.md](browser-integration.md): `page.evaluate()` execution model
- **Pattern library** → [pattern-library.md](pattern-library.md): Which plugins need L3
- **Compiler** → [compiler-pipeline.md](compiler-pipeline.md): Phase 3 L3 classification
