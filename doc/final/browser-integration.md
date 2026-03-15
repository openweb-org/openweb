# Browser Integration & Capture Architecture

> **Status**: COMPLETE
> **Addresses**: Gaps 002, 003, 006, 011
> **Principle**: OpenWeb does not own the browser.

## Core Architecture

The user's agent (Claude Code, Cursor, etc.) drives the browser via Playwright CLI.
OpenWeb connects alongside for capture and tool execution. One Chrome instance, two
consumers, zero conflict.

```
Chrome (--remote-debugging-port=9222)
  │
  ├── Playwright CLI ──── agent drives browsing
  │     goto, click, fill, eval, screenshot
  │
  └── OpenWeb SDK ─────── compiler captures + executor runs tools
        connectOverCDP(), HAR recording, CDP listeners, page.evaluate()
```

### Scope Separation

| Playwright CLI (agent) | OpenWeb (compiler + executor) |
|---|---|
| Navigate (goto, click, fill) | Capture traffic + state |
| Screenshots / a11y tree | Pattern detection |
| Storage access (read/write) | Spec generation (L1 + L2 + L3) |
| JS execution (eval) | Tool execution (L2/L3 primitives) |
| Session management | Self-healing (fingerprint drift) |

### Why Two Layers

**Agent uses CLI** — token-efficient commands designed for LLM agents. A `goto` +
`snapshot` is ~100 tokens. Loading a full Playwright SDK tool schema would be ~5000.

**OpenWeb uses SDK** — needs programmatic CDP session management, `recordHar` API,
structured event handling for WebSocket frames, and `page.evaluate()` for L2/L3
primitive execution. The compiler is a Node.js process, not an LLM agent.

---

## CDP Connection Model

### Connecting to the Agent's Browser

```typescript
import { chromium } from 'playwright';

// Agent's browser is already running with remote debugging
const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0]; // agent's browsing context
const page = context.pages()[0];       // current page
```

**CLI startup** (by the agent or user):
```bash
# Agent typically starts Chrome with remote debugging:
playwright-cli --cdpEndpoint=http://localhost:9222 goto "https://example.com"

# OpenWeb attaches:
openweb capture start --cdp-endpoint http://localhost:9222
```

### Session Isolation

Playwright CLI supports named sessions (`-s=session-name`). OpenWeb does NOT
create its own session — it connects to the agent's existing context. If the
agent uses multiple sessions, OpenWeb can target a specific one:

```bash
openweb capture start --cdp-endpoint http://localhost:9222 --session default
```

### Connection Lifecycle

```
1. Agent starts browser (or OpenWeb detects running instance)
2. OpenWeb connects via connectOverCDP()
3. OpenWeb attaches listeners (network, WebSocket, navigation)
4. Agent browses — OpenWeb passively records
5. Agent signals "done browsing" (or timeout)
6. OpenWeb detaches, writes capture bundle
```

OpenWeb never navigates, clicks, or modifies page state during capture.
It is a **passive observer** (except for `page.evaluate()` to read globals/DOM,
which is read-only).

---

## Multi-Source Capture

### 1. HTTP Traffic (HAR)

Standard HAR via Playwright's recording API:

```typescript
// Start HAR recording
await context.routeFromHAR('capture/traffic.har', { update: true });

// Or manual capture via event listeners (more control):
page.on('request', (req) => {
  harEntries.push({
    startedDateTime: new Date().toISOString(),
    request: {
      method: req.method(),
      url: req.url(),
      headers: req.headers(),
      postData: req.postData(),
    },
  });
});

page.on('response', async (res) => {
  const entry = findEntry(res.request());
  entry.response = {
    status: res.status(),
    headers: res.headers(),
    content: await res.body().catch(() => null),
  };
});
```

**Traffic filtering** (applied during capture, not post-hoc):

```typescript
const BLOCKED_DOMAINS = new Set([
  'google-analytics.com', 'googletagmanager.com', 'segment.io',
  'mixpanel.com', 'amplitude.com', 'hotjar.com', 'sentry.io',
  'doubleclick.net', 'facebook.net', 'criteo.com', 'datadog-agent',
  // ~40 total analytics/tracking domains
]);

const API_CONTENT_TYPES = new Set([
  'application/json', 'application/vnd.api+json', 'text/json',
  'application/x-www-form-urlencoded', 'application/graphql+json',
  'application/graphql-response+json',
]);

function shouldCapture(url: URL, contentType: string | null): boolean {
  if (BLOCKED_DOMAINS.has(url.hostname)) return false;
  if (contentType && !API_CONTENT_TYPES.has(contentType.split(';')[0])) return false;
  if (url.pathname.match(/\.(js|css|png|jpg|gif|svg|woff2?|ttf)$/)) return false;
  return true;
}
```

### 2. WebSocket Frames (JSONL)

Captured via CDP `Network.webSocketFrame*` events:

```typescript
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');

const wsLog: WsFrame[] = [];

cdp.on('Network.webSocketCreated', (e) => {
  wsLog.push({
    connectionId: e.requestId,
    timestamp: new Date().toISOString(),
    type: 'open',
    url: e.url,
  });
});

cdp.on('Network.webSocketFrameSent', (e) => {
  wsLog.push({
    connectionId: e.requestId,
    timestamp: new Date().toISOString(),
    type: 'frame',
    direction: 'sent',
    opcode: e.response.opcode,
    payload: e.response.payloadData,
  });
});

cdp.on('Network.webSocketFrameReceived', (e) => {
  wsLog.push({
    connectionId: e.requestId,
    timestamp: new Date().toISOString(),
    type: 'frame',
    direction: 'received',
    opcode: e.response.opcode,
    payload: e.response.payloadData,
  });
});

cdp.on('Network.webSocketClosed', (e) => {
  wsLog.push({
    connectionId: e.requestId,
    timestamp: new Date().toISOString(),
    type: 'close',
  });
});
```

**JSONL output format** (`websocket_frames.jsonl`):
```jsonl
{"connectionId":"ws1","timestamp":"2026-03-15T10:00:00.000Z","type":"open","url":"wss://gateway.discord.gg/?v=10"}
{"connectionId":"ws1","timestamp":"2026-03-15T10:00:00.100Z","type":"frame","direction":"sent","opcode":1,"payload":"{\"op\":2,\"d\":{\"token\":\"...\",\"intents\":32767}}"}
{"connectionId":"ws1","timestamp":"2026-03-15T10:00:00.200Z","type":"frame","direction":"received","opcode":1,"payload":"{\"t\":\"READY\",\"op\":0,\"d\":{\"guilds\":[...]}}"}
{"connectionId":"ws1","timestamp":"2026-03-15T10:05:00.000Z","type":"close","code":1000}
```

**TypeScript type**:
```typescript
type WsFrame =
  | { connectionId: string; timestamp: string; type: 'open'; url: string }
  | { connectionId: string; timestamp: string; type: 'frame';
      direction: 'sent' | 'received'; opcode: number; payload: string }
  | { connectionId: string; timestamp: string; type: 'close'; code?: number };
```

**Relevance**: Discord, ClickUp, Slack use WebSocket for real-time features.
ClickUp sends auth tokens over WebSocket (Gap 003). Capturing frames enables
the compiler to detect `websocket_intercept` auth patterns.

### 3. Browser State Snapshots

Taken at capture start and after each page navigation:

```typescript
async function captureStateSnapshot(
  page: Page,
  context: BrowserContext,
  trigger: string,
): Promise<StateSnapshot> {
  return {
    timestamp: new Date().toISOString(),
    trigger, // 'initial' | 'navigation' | 'manual'
    url: page.url(),
    localStorage: await page.evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        data[key] = localStorage.getItem(key)!;
      }
      return data;
    }),
    sessionStorage: await page.evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)!;
        data[key] = sessionStorage.getItem(key)!;
      }
      return data;
    }),
    cookies: await context.cookies(),
  };
}
```

**Navigation detection** — auto-snapshot on URL change:
```typescript
page.on('framenavigated', async (frame) => {
  if (frame === page.mainFrame()) {
    await page.waitForLoadState('domcontentloaded');
    const snapshot = await captureStateSnapshot(page, context, 'navigation');
    snapshots.push(snapshot);
  }
});
```

**TypeScript type**:
```typescript
interface StateSnapshot {
  timestamp: string;
  trigger: 'initial' | 'navigation' | 'manual';
  url: string;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
    expires: number;
  }>;
}
```

**Relevance**: 60+ plugins extract auth tokens from browser storage (Gap 002).
Snapshots enable the compiler to correlate `localStorage['BSKY_STORAGE']` →
`Authorization: Bearer xxx` during Phase 2 parameter differentiation.

### 4. DOM & Globals Extraction

Captured after each navigation (alongside state snapshots):

```typescript
async function captureDomAndGlobals(page: Page): Promise<DomExtraction> {
  return page.evaluate(() => {
    // Meta tags
    const metaTags = Array.from(document.querySelectorAll('meta[name]')).map(m => ({
      name: m.getAttribute('name')!,
      content: m.getAttribute('content') ?? '',
    }));

    // Script JSON tags (metadata only — content can be large)
    const scriptJsonTags = Array.from(
      document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]'),
    ).map(s => ({
      id: s.id || null,
      type: s.getAttribute('type'),
      dataTarget: s.getAttribute('data-target') || null,
      size: (s.textContent ?? '').length,
    }));

    // Hidden form inputs
    const hiddenInputs = Array.from(
      document.querySelectorAll('input[type="hidden"]'),
    ).map(i => ({
      name: i.getAttribute('name'),
      formAction: i.closest('form')?.getAttribute('action') ?? null,
    }));

    // Framework globals (detect presence + type, not full content)
    const KNOWN_GLOBALS = [
      '__NEXT_DATA__', '__NUXT__', '__NUXT_DATA__',
      '__APOLLO_STATE__', '__APOLLO_CLIENT__',
      '__PRELOADED_STATE__', '__UNIVERSAL_DATA_FOR_REHYDRATION__',
      'ytcfg', '__context__', '__initialData', 'PRELOADED',
      'netflix', 'StackExchange', 'initData', 'bootstrap',
      'POSTHOG_APP_CONTEXT', '__nr', 'gon', 'WIZ_global_data',
      'webpackChunkdiscord_app', 'webpackChunk_N_E',
    ];

    const globals: Record<string, string> = {};
    for (const key of KNOWN_GLOBALS) {
      try {
        const val = (window as any)[key];
        if (val !== undefined) {
          globals[key] = typeof val === 'object' ? 'object' : typeof val;
        }
      } catch { /* cross-origin or getter error */ }
    }

    // Also detect any webpackChunk* globals
    const webpackChunks = Object.keys(window)
      .filter(k => k.startsWith('webpackChunk'));

    // gapi availability
    const gapiAvailable = typeof (window as any).gapi?.client?.request === 'function';

    return { metaTags, scriptJsonTags, hiddenInputs, globals, webpackChunks, gapiAvailable };
  });
}
```

**TypeScript type**:
```typescript
interface DomExtraction {
  metaTags: Array<{ name: string; content: string }>;
  scriptJsonTags: Array<{
    id: string | null;
    type: string | null;
    dataTarget: string | null;
    size: number;
  }>;
  hiddenInputs: Array<{ name: string | null; formAction: string | null }>;
  globals: Record<string, string>; // key → typeof value
  webpackChunks: string[];
  gapiAvailable: boolean;
}
```

**Relevance**: Globals detection feeds directly into Phase 3 pattern matching.
`__NEXT_DATA__` → `ssr_next_data` (Gap 006). `gapi.client` → `gapi_proxy` (Gap 010).
`webpackChunk*` → `webpack_module_walk` (Gap 002). Meta CSRF tags → `meta_tag` (Gap 005).

---

## Capture Bundle

All capture outputs are written to a directory:

```
capture/
├── traffic.har                 # Filtered HTTP traffic
├── websocket_frames.jsonl      # WebSocket frame log (if any WS connections)
├── state_snapshots/
│   ├── 001_initial.json        # StateSnapshot
│   ├── 002_after_login.json
│   └── 003_after_search.json
├── dom_extractions/
│   ├── 001_initial.json        # DomExtraction
│   └── 002_after_login.json
└── metadata.json               # CaptureMetadata
```

**Metadata**:
```typescript
interface CaptureMetadata {
  siteUrl: string;
  startTime: string;
  endTime: string;
  pageCount: number;      // number of navigations observed
  requestCount: number;   // HTTP requests captured (after filtering)
  wsConnectionCount: number;
  snapshotCount: number;
  captureVersion: string; // openweb version that produced this bundle
}
```

---

## Tool Execution (Runtime)

When the runtime executor needs browser context for L2/L3 primitives, it connects
to the same Chrome instance:

```typescript
// Runtime connects to agent's browser
const browser = await chromium.connectOverCDP(cdpEndpoint);
const page = browser.contexts()[0].pages()[0];

// Execute L2 primitive — e.g., extract localStorage JWT
const token = await page.evaluate((config) => {
  const raw = localStorage.getItem(config.key);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  // Walk dot-path to extract token
  return config.path.split('.').reduce((obj, key) => obj?.[key], parsed);
}, { key: 'BSKY_STORAGE', path: 'session.currentAccount.accessJwt' });

// Use token for HTTP request
const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
});
```

For `mode: browser_fetch`, the entire request happens in page context:

```typescript
// L2 browser_fetch: execute in page
const result = await page.evaluate(async (params) => {
  const res = await fetch(params.url, {
    method: params.method,
    headers: params.headers,
    body: params.body,
    credentials: 'include',
  });
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers),
    body: await res.text(),
  };
}, requestParams);
```

For L3 code adapters, the adapter's `execute()` function receives the `page` object
directly. See [layer3-code-adapters.md](layer3-code-adapters.md).

---

## Non-HTTP Protocol Support

### AsyncAPI 3.x for WebSocket/SSE (L1)

WebSocket APIs with structured message schemas are described via AsyncAPI 3.x.
This covers sites where WebSocket messages follow predictable patterns:
Discord (gateway opcodes), ClickUp (real-time updates), Slack (RTM events).

**Design decision: No `x-openweb` in AsyncAPI.** WebSocket auth tokens come from
the same source as HTTP auth (extracted once via L2 primitives in `openapi.yaml`).
The runtime injects the token into WS auth frames implicitly — the AsyncAPI message
schema defines where the token field is, the runtime fills it from the shared auth
context. This keeps AsyncAPI as pure standard format with no vendor extensions.
If WS-specific auth complexity emerges later, we can add `x-openweb` then.

```yaml
# asyncapi.yaml (Discord gateway)
asyncapi: 3.0.0
info:
  title: Discord Gateway
  version: "10"
channels:
  gateway:
    address: wss://gateway.discord.gg/?v=10
    messages:
      identify:
        name: identify
        payload:
          type: object
          properties:
            op: { type: integer, const: 2 }
            d:
              type: object
              properties:
                token: { type: string }
                intents: { type: integer }
      dispatch:
        name: dispatch
        payload:
          type: object
          properties:
            op: { type: integer, const: 0 }
            t: { type: string }
            d: { type: object }
      heartbeat:
        name: heartbeat
        payload:
          type: object
          properties:
            op: { type: integer, const: 1 }
            d: { type: integer, nullable: true }
```

Sites where WebSocket is too complex for structured description (WhatsApp, Telegram)
fall to L3 code adapters.

### SSE (Server-Sent Events)

Captured as HTTP responses with `Content-Type: text/event-stream`.
The HAR captures the initial request; individual events are logged in a
separate JSONL file following the same format as WebSocket frames:

```jsonl
{"connectionId":"sse1","timestamp":"...","type":"open","url":"https://api.example.com/events"}
{"connectionId":"sse1","timestamp":"...","type":"frame","direction":"received","payload":"data: {\"type\":\"update\"}"}
```

---

## Playwright CLI Command Reference

Commands the agent uses (OpenWeb does NOT call these — it uses SDK equivalently):

| Command | Purpose | OpenWeb equivalent |
|---|---|---|
| `goto <url>` | Navigate | (agent only) |
| `click <selector>` | Interact | (agent only) |
| `eval <expr>` | Run JS | `page.evaluate()` |
| `localstorage-list` | Read localStorage | `page.evaluate(() => ({...localStorage}))` |
| `sessionstorage-list` | Read sessionStorage | `page.evaluate(() => ({...sessionStorage}))` |
| `cookie-list` | Read cookies | `context.cookies()` |
| `network` | List HTTP requests | HAR recording or `page.on('request')` |
| `run-code <code>` | Execute Playwright script | Direct SDK calls |
| `tracing-start/stop` | Record traces | `context.tracing.start/stop()` |
| `state-save/load` | Export/import state | `context.storageState()` |
| `snapshot` | Page state snapshot | `page.evaluate()` + custom extraction |

---

## Error Handling

### CDP Connection Failures

```typescript
async function connectWithRetry(cdpEndpoint: string, maxRetries = 3): Promise<Browser> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await chromium.connectOverCDP(cdpEndpoint, { timeout: 30_000 });
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error('unreachable');
}
```

### Page Navigation During Capture

When the agent navigates to a new page, OpenWeb must re-attach listeners:

```typescript
context.on('page', async (newPage) => {
  attachListeners(newPage); // re-attach request/response/WS listeners
  await captureStateSnapshot(newPage, context, 'navigation');
  await captureDomAndGlobals(newPage);
});
```

### Stale Page Context

If the page navigates or reloads while OpenWeb is evaluating JS, the
`page.evaluate()` call will throw `TargetClosedError`. The executor
should catch and retry after `waitForLoadState('domcontentloaded')`.

---

## Cross-References

- **Capture pipeline** → [compiler-pipeline.md](compiler-pipeline.md): Phase 1 uses this capture architecture
- **L2 primitives** → [layer2-interaction-primitives.md](layer2-interaction-primitives.md): Runtime execution uses `page.evaluate()`
- **L3 adapters** → [layer3-code-adapters.md](layer3-code-adapters.md): Adapters receive `page` object
- **Runtime** → [runtime-executor.md](runtime-executor.md): Executor connects via CDP for L2/L3 execution
- **Package format** → [skill-package-format.md](skill-package-format.md): AsyncAPI placement in package
