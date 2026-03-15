# Compiler Pipeline v2

> **Status**: COMPLETE
> **Evolved from**: v1 (`archive/v1/architecture-pipeline.md`)
> **Addresses**: All 12 design gaps (capture + detection + emission)

## Overview

The compiler transforms observed website behavior into a three-layer skill package.

```
Agent browses via Playwright CLI
        │
        ▼
Phase 1: Capture ─────── multi-source recording (HTTP + WS + state + DOM)
        │
        ▼
Phase 2: Analyze ─────── clustering, parameter differentiation, schema induction
        │
        ▼
Phase 3: Pattern Match ── detect L2 primitives, probe execution modes, classify L3
        │
        ▼
Phase 4: Emit ────────── OpenAPI 3.1 + x-openweb L2 + L3 adapter stubs
```

### What Changed from v1

| Aspect | v1 | v2 |
|---|---|---|
| Navigation | Built-in agent (~200 LOC) | User's agent drives via Playwright CLI |
| Capture | HAR only | HAR + JSONL (WebSocket) + state snapshots + DOM |
| Phase 3 | Probe execution modes only | Probe + pattern match against L2 library |
| Emission | OpenAPI + `x-openweb.session` | OpenAPI + full L2 primitives + L3 stubs |
| WebSocket | Not supported | AsyncAPI 3.x + JSONL capture |

---

## Phase 1: Capture

**Goal**: Record all observable website behavior while the agent browses.

**Trigger**: `openweb capture start --cdp-endpoint http://localhost:9222`

OpenWeb connects to the agent's browser via Playwright SDK `connectOverCDP()`.
The agent continues browsing via Playwright CLI. Both share the same Chrome instance.
See [browser-integration.md](browser-integration.md) for CDP session management.

### Capture Sources

**1. HTTP Traffic** — Standard HAR via Playwright `recordHar`:
```typescript
const context = browser.contexts()[0];
await context.routeFromHAR('capture/traffic.har', { update: true });
// Or: page.on('request', ...) + page.on('response', ...)
```
Applies v1 three-layer traffic filtering:
- Domain blocklist (analytics, ads, tracking — ~40 domains)
- Content-type filter (keep JSON, form-encoded; skip images, CSS, fonts)
- Path noise filter (skip `/_next/static/*`, `/hot-update.*`, `/health`)

**2. WebSocket Frames** — CDP `Network.webSocketFrame*` events:
```typescript
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');

cdp.on('Network.webSocketCreated', (e) => log({ type: 'open', ...e }));
cdp.on('Network.webSocketFrameSent', (e) => log({ type: 'frame', direction: 'sent', ...e }));
cdp.on('Network.webSocketFrameReceived', (e) => log({ type: 'frame', direction: 'received', ...e }));
cdp.on('Network.webSocketClosed', (e) => log({ type: 'close', ...e }));
```

**JSONL format** (`websocket_frames.jsonl`):
```jsonl
{"connectionId":"ws1","timestamp":"...","type":"open","url":"wss://gateway.discord.gg/?v=10"}
{"connectionId":"ws1","timestamp":"...","type":"frame","direction":"sent","opcode":1,"payload":"{\"op\":2,\"d\":{\"token\":\"...\"}}"}
{"connectionId":"ws1","timestamp":"...","type":"frame","direction":"received","opcode":1,"payload":"{\"op\":0,\"d\":{\"guilds\":[...]}}"}
{"connectionId":"ws1","timestamp":"...","type":"close","code":1000}
```

**3. Browser State Snapshots** — taken at capture start + after each navigation:
```typescript
const snapshot = {
  timestamp: new Date().toISOString(),
  trigger: 'navigation',  // or 'initial', 'manual'
  url: page.url(),
  localStorage: await page.evaluate(() => ({ ...localStorage })),
  sessionStorage: await page.evaluate(() => ({ ...sessionStorage })),
  cookies: await context.cookies(),
  globals: await page.evaluate(() => {
    // Auto-detect common framework globals
    const known = [
      '__NEXT_DATA__', '__NUXT__', '__APOLLO_STATE__', '__APOLLO_CLIENT__',
      'ytcfg', '__context__', '__initialData', 'PRELOADED',
      'netflix', 'StackExchange', 'initData', 'bootstrap',
      'POSTHOG_APP_CONTEXT', '__nr', 'gon', 'WIZ_global_data',
    ];
    const found: Record<string, unknown> = {};
    for (const k of known) {
      try { if ((window as any)[k]) found[k] = (window as any)[k]; } catch {}
    }
    return found;
  }),
};
```

**4. DOM Extractions** — SSR data, meta tags, hidden inputs:
```typescript
const domData = await page.evaluate(() => ({
  metaTags: Array.from(document.querySelectorAll('meta[name]')).map(m => ({
    name: m.getAttribute('name'),
    content: m.getAttribute('content'),
  })),
  scriptJsonTags: Array.from(
    document.querySelectorAll('script[type="application/json"]')
  ).map(s => ({
    id: s.id,
    dataTarget: s.getAttribute('data-target'),
    length: s.textContent?.length ?? 0,
    // Don't capture full content here — too large. Just metadata.
  })),
  hiddenInputs: Array.from(
    document.querySelectorAll('input[type="hidden"]')
  ).map(i => ({
    name: i.getAttribute('name'),
    formAction: i.closest('form')?.getAttribute('action'),
  })),
  webpackChunks: Object.keys(window).filter(k => k.startsWith('webpackChunk')),
  gapiAvailable: typeof (window as any).gapi?.client?.request === 'function',
}));
```

### Capture Output

```
capture/
├── traffic.har                 # HTTP requests/responses (filtered)
├── websocket_frames.jsonl      # WebSocket frame log
├── state_snapshots/
│   ├── 001_initial.json        # { localStorage, sessionStorage, cookies, globals }
│   ├── 002_after_login.json
│   └── 003_after_search.json
├── dom_extractions/
│   ├── 001_initial.json        # { metaTags, scriptJsonTags, hiddenInputs, ... }
│   └── 002_after_login.json
└── metadata.json               # { siteUrl, startTime, endTime, pageCount }
```

### Variance Generation

The agent should exercise each flow 2-3 times with different inputs to enable
parameter differentiation in Phase 2. Example:

```
Flow: search for product
  Run 1: search("laptop")       → records traffic
  Run 2: search("headphones")   → records traffic
  → Phase 2 diffs requests to find which fields are user-input vs constant
```

For authenticated sites, capture state both before and after login to
distinguish session tokens from static config.

---

## Phase 2: Analyze & Extract

**Goal**: Transform raw capture bundle into a canonical API map with parameterized
endpoint templates and inferred schemas.

**Unchanged from v1** in core algorithm. Four sub-steps:

### Step A: Endpoint Clustering

Group requests by `(HTTP method, URL path pattern, Content-Type)`.

**URL Normalization** — replace variable path segments with `{param}`:
```typescript
const PARAM_PATTERNS = [
  { pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, name: 'id' },
  { pattern: /^\d{3,}$/, name: 'id' },
  { pattern: /^[0-9a-f]{8,}$/i, name: 'hash' },
  { pattern: /^[A-Za-z0-9+/=]{16,}$/, name: 'token' },
  { pattern: /^\d{4}-\d{2}-\d{2}/, name: 'date' },
];
```

**GraphQL first-class support**: Cluster by `operationName`, not URL path.
Support `extensions.persistedQuery.sha256Hash` for persisted queries.

**NEW in v2 — WebSocket message clustering:**
Group WebSocket frames by `(connectionUrl, opcode/messageType)`. For JSON payloads,
cluster by top-level `type` or `op` field. Example for Discord:
```
ws://gateway.discord.gg → op:0 (DISPATCH), op:1 (HEARTBEAT), op:2 (IDENTIFY), ...
```

### Step B: Parameter Differentiation

Classify every variable field in clustered endpoints:

| Classification | Signal | Example |
|---|---|---|
| user_input | Varies freely across runs | `q=laptop` |
| pagination | Monotonic sequence values | `cursor=eyJ...` |
| session_token | Same within session, differs across | `Authorization: Bearer ...` |
| csrf_nonce | Changes every request | `X-CSRFToken: a8f3...` |
| derived | Hash/timestamp, not user-controlled | `_t=1708900000` |
| constant | Same value always | `format=json` |

**NEW in v2 — Browser state correlation:**
Cross-reference HTTP header values against captured browser state:

```typescript
function correlateTokenSources(
  request: HarRequest,
  stateSnapshot: StateSnapshot,
): TokenCorrelation[] {
  const correlations: TokenCorrelation[] = [];
  const authHeader = request.headers.find(h => h.name === 'Authorization');

  if (authHeader) {
    const token = authHeader.value.replace(/^Bearer\s+/, '');
    // Check localStorage
    for (const [key, value] of Object.entries(stateSnapshot.localStorage)) {
      if (containsToken(value, token)) {
        correlations.push({
          header: 'Authorization',
          source: 'localStorage',
          key,
          path: findJsonPath(value, token),
        });
      }
    }
    // Check sessionStorage, cookies, page globals (same pattern)
  }
  return correlations;
}
```

This correlation is the key input to Phase 3 pattern matching. When we find that
`Authorization: Bearer xxx` comes from `localStorage['BSKY_STORAGE'].session.accessJwt`,
we know to emit `auth: { type: localStorage_jwt, key: 'BSKY_STORAGE', path: '...' }`.

### Step C: Schema Induction

Use `quicktype-core` to merge observed JSON samples into unified JSON Schema.
LLM generates human-readable field descriptions. **Unchanged from v1.**

### Step D: Dependency Graph

Map data flow between endpoints via field name matching. **Unchanged from v1.**

**Output**: `api-map/` directory with clustered endpoints, parameterized templates,
schemas, and dependency graph.

---

## Phase 3: Probe & Pattern Match

**Goal**: Determine execution mode per endpoint AND detect L2 interaction primitives.
This is the **key v2 innovation** — v1 only probed execution modes.

### Step A: Execution Mode Probing (from v1)

Try cheapest mode first, escalate on failure:
`direct_http` → `session_http` → `browser_fetch`

For read endpoints only (GET). Write endpoints default to `browser_fetch`.
≤6 requests per endpoint. Stop at first success.

### Step B: L2 Pattern Detection (NEW)

Using the capture bundle + Phase 2 correlations, detect which L2 primitives apply.

**Auth Pattern Detection:**

| Detection Logic | Emitted Primitive |
|---|---|
| Token found in `localStorage[key].path` → `Authorization` header | `localStorage_jwt` |
| Token found in `sessionStorage[key]` → `Authorization` header | `sessionStorage_token` |
| sessionStorage keys matching `msal.token.keys.*` | `sessionStorage_msal` |
| Token found in `window.global.path` → header/query | `page_global` |
| `webpackChunk*` globals detected + token not in storage/cookies | `webpack_module_walk` (flag for manual config) |
| `wss://` frames contain auth token before HTTP calls | `websocket_intercept` |
| Auth endpoint called (e.g., `/api/auth/session`) before data calls | `lazy_fetch` |
| Multiple auth endpoints with token passing between them | `exchange_chain` (flag for manual config) |
| Only HttpOnly cookies, no extracted tokens | `cookie_session` |

**CSRF Pattern Detection:**

| Detection Logic | Emitted Primitive |
|---|---|
| Non-HttpOnly cookie value appears as custom header on mutations | `cookie_to_header` |
| `<meta name="csrf-token">` found in DOM extractions | `meta_tag` |
| `window.global.path` value appears as header/body field on mutations | `page_global` |
| `<input name="authenticity_token">` in hidden inputs | `form_field` |
| Token from API response used in subsequent mutation headers/body | `api_response` |

**Signing Pattern Detection:**

| Detection Logic | Emitted Primitive |
|---|---|
| `Authorization` matches `SAPISIDHASH \d+_[0-9a-f]{40}` | `sapisidhash` |
| `gapi.client` available on window | `gapi_proxy` |
| AWS-style Authorization header with `AWS4-HMAC-SHA256` | `aws_sigv4` |
| Header value changes every request + crypto functions in page JS | Flag as L3 |

**Extraction Pattern Detection:**

| Detection Logic | Emitted Primitive |
|---|---|
| `__NEXT_DATA__` in captured globals | `ssr_next_data` |
| `__NUXT__` in captured globals | `ssr_nuxt` |
| `__APOLLO_STATE__` or `__APOLLO_CLIENT__` in globals | `apollo_cache` |
| `<script type="application/json">` with large payloads in DOM | `script_json` |
| No API calls but structured data in window globals | `page_global_data` |
| No API calls, no globals, only HTML with structured content | `html_selector` |

**Pagination Pattern Detection:**

| Detection Logic | Emitted Primitive |
|---|---|
| Response contains `Link` header with `rel="next"` | `link_header` |
| Response field appears as query param in next request to same endpoint | `cursor` |
| Sequential `offset`/`page` param values across requests | `offset_limit` or `page_number` |

### Step C: Confidence & Manual Flagging

Each detected pattern gets a confidence score:

| Confidence | Meaning | Action |
|---|---|---|
| **high** (>0.9) | Exact match: token value found in storage → header | Auto-emit primitive |
| **medium** (0.6-0.9) | Likely match: pattern detected but can't fully verify | Emit with `# TODO: verify` comment |
| **low** (<0.6) | Heuristic only: signals present but no concrete correlation | Flag for manual review |

**Auto-detected** (high confidence, validated against OpenTabs plugins):

| Pattern | Detection | Validated by plugin |
|---|---|---|
| `localStorage_jwt` | Token in localStorage matches Authorization header | Bluesky, Linear, Robinhood |
| `cookie_to_header` | Cookie value = custom header value on mutations | Instagram, LeetCode, Sentry |
| `meta_tag` CSRF | `<meta name="csrf-token">` in DOM | GitHub, Calendly |
| `cookie_session` | HttpOnly cookies, no extracted tokens | Claude, Coinbase, Fidelity |
| `sapisidhash` | Authorization header pattern match | YouTube |
| `ssr_next_data` | `__NEXT_DATA__` in globals | Zillow, Walmart |
| `link_header` | `Link` header in responses | Sentry |
| `cursor` pagination | Response field → next request param | Bluesky, Discord |

**Requires manual config** (low confidence, complex patterns):

| Pattern | Why auto-detection is insufficient |
|---|---|
| `webpack_module_walk` | Can detect `webpackChunk*` globals but can't determine `module_test`/`call` |
| `exchange_chain` | Can detect multi-step auth flows but can't infer step sequence |
| `websocket_intercept` | Can detect WS auth frames but frame_match config needs manual spec |
| `gapi_proxy` | Can detect `gapi.client` but api_key source path varies |
| `form_field` CSRF | Can detect hidden inputs but can't determine which form/URL to fetch |

### Step D: Risk Classification

Deterministic rule-based, **unchanged from v1**:

| Condition | Risk Tier |
|---|---|
| Auth paths (`/login`, `/oauth`, `/token`) | critical |
| Payment paths (`payment`, `checkout`, `billing`) | critical |
| HTTP DELETE or destructive paths | high |
| POST/PUT/PATCH with PII | high |
| POST/PUT/PATCH (no PII) | medium |
| GET with PII in response | low |
| Everything else | safe |

**Output**: Per-endpoint: execution mode + L2 primitive config + risk tier + confidence.

---

## Phase 4: Emit Three-Layer Package

**Goal**: Produce a deployable skill package with L1 + L2 + L3 artifacts.

### L1: OpenAPI 3.1 + AsyncAPI 3.x

Standard spec generation, **evolved from v1**:

```yaml
# openapi.yaml
openapi: 3.1.0
info:
  title: Bluesky XRPC API
  version: "1.0"
  x-openweb:
    spec_version: "2.0"
    compiled_at: "2026-03-15T10:00:00Z"
servers:
  - url: https://bsky.social/xrpc
    x-openweb:
      mode: session_http
      auth:
        type: localStorage_jwt
        key: BSKY_STORAGE
        path: session.currentAccount.accessJwt
        inject:
          header: Authorization
          prefix: "Bearer "
paths:
  /app.bsky.feed.getTimeline:
    get:
      operationId: getTimeline
      summary: Get the authenticated user's timeline
      x-openweb:
        risk_tier: safe
        stable_id: "a1b2c3d4"
        tool_version: 1
        verified: true
        pagination:
          type: cursor
          response_field: cursor
          request_param: cursor
      parameters:
        - name: limit
          in: query
          schema: { type: integer, default: 50 }
        - name: cursor
          in: query
          schema: { type: string }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  cursor: { type: string }
                  feed: { type: array, items: { $ref: '#/components/schemas/FeedItem' } }
```

For sites with WebSocket APIs, emit AsyncAPI 3.x alongside:

```yaml
# asyncapi.yaml (Discord example)
asyncapi: 3.0.0
info:
  title: Discord Gateway API
channels:
  gateway:
    address: wss://gateway.discord.gg/?v=10
    messages:
      dispatch:
        payload:
          type: object
          properties:
            op: { type: integer, const: 0 }
            t: { type: string }
            d: { type: object }
```

### L2: Primitive Configs in x-openweb

L2 primitives are emitted as `x-openweb` extensions on the appropriate level:
- Server-level: `auth`, `csrf`, `signing`
- Operation-level: `pagination`, `extraction`

Schema definitions in [layer2-interaction-primitives.md](layer2-interaction-primitives.md).

### L3: Code Adapter Stubs

For endpoints classified as L3, emit adapter stub files:

```typescript
// adapters/onlyfans-signing.ts
import type { CodeAdapter } from '@openweb/runtime';

export default {
  name: 'onlyfans-signing',
  description: 'Request signing via webpack module 977434',
  // TODO: Implement — extract signing function from webpack bundle
  async execute(page, request) {
    // page.evaluate(() => { ... webpack module access ... })
    throw new Error('Not implemented — requires manual adapter code');
  },
} satisfies CodeAdapter;
```

See [layer3-code-adapters.md](layer3-code-adapters.md) for the full adapter interface.

### Package Layout

```
bluesky/
├── manifest.json           # metadata, fingerprint, dependencies
├── openapi.yaml            # L1 + L2 (x-openweb extensions)
├── asyncapi.yaml           # L1 WebSocket/SSE (if applicable)
├── adapters/               # L3 code adapters (if applicable)
│   └── *.ts
└── tests/
    └── smoke.test.ts       # per-tool regression tests
```

See [skill-package-format.md](skill-package-format.md) for full layout spec.

### Fingerprinting

Detect site changes via composite hash:

```typescript
interface SiteFingerprint {
  js_bundle_hash: string;        // SHA256 of main JS bundle URLs
  api_endpoint_set_hash: string; // SHA256 of sorted endpoint list
  response_shape_hash: string;   // SHA256 of response schema set
  last_validated: string;        // ISO timestamp
}
```

Stored in `manifest.json`. When fingerprint changes, compiler flags the skill
for recompilation.

---

## Pipeline Example: Instagram

Showing how the four phases process Instagram end-to-end.

**Phase 1 Capture** — Agent logs in, browses feed, likes a post:
- `traffic.har`: 47 API calls to `/api/v1/*` (after filtering)
- `state_snapshots/001_initial.json`: `csrftoken` cookie present
- `dom_extractions/001.json`: no meta CSRF tags, no SSR globals

**Phase 2 Analyze**:
- Cluster: 12 endpoint templates (`/api/v1/feed/timeline/`, `/api/v1/media/{id}/like/`, etc.)
- Parameter diff: `csrftoken` cookie value = `X-CSRFToken` header value → classified as `csrf_nonce`
- Schema: response schemas inferred via quicktype

**Phase 3 Pattern Match**:
- Auth: Only HttpOnly cookies → `cookie_session` (high confidence)
- CSRF: `csrftoken` cookie value matches `X-CSRFToken` header → `cookie_to_header` (high confidence)
- Additional headers: `X-IG-App-ID: 936619743392459` constant → emit as default header
- Mode: `session_http` (cookies required, no browser JS needed for API calls)

**Phase 4 Emit**:
```yaml
servers:
  - url: https://www.instagram.com/api/v1
    x-openweb:
      mode: session_http
      auth:
        type: cookie_session
      csrf:
        type: cookie_to_header
        cookie: csrftoken
        header: X-CSRFToken
paths:
  /feed/timeline/:
    get:
      operationId: getTimeline
      x-openweb:
        risk_tier: safe
        pagination:
          type: cursor
          response_field: next_max_id
          request_param: max_id
  /media/{media_id}/like/:
    post:
      operationId: likeMedia
      x-openweb:
        risk_tier: medium
```

---

## Pipeline Example: Discord

**Phase 1 Capture**:
- `traffic.har`: 23 API calls to `/api/v9/*`
- `websocket_frames.jsonl`: 150+ frames on `wss://gateway.discord.gg`
- `state_snapshots/001.json`: no auth tokens in localStorage/sessionStorage
- `dom_extractions/001.json`: `webpackChunkdiscord_app` detected on window

**Phase 3 Pattern Match**:
- Auth: Token not in storage/cookies. `webpackChunkdiscord_app` present.
  → `webpack_module_walk` (medium confidence, needs manual `module_test`/`call`)
- No CSRF, no signing
- WebSocket: Auth frame detected (`{"method":"auth","token":"..."}`)

**Phase 4 Emit**:
```yaml
# openapi.yaml
servers:
  - url: https://discord.com/api/v9
    x-openweb:
      mode: browser_fetch
      auth:
        type: webpack_module_walk
        chunk_global: webpackChunkdiscord_app
        module_test: "typeof exports.getToken === 'function'"  # TODO: verify
        call: "exports.getToken()"
        inject:
          header: Authorization
```
```yaml
# asyncapi.yaml
asyncapi: 3.0.0
info:
  title: Discord Gateway
channels:
  gateway:
    address: wss://gateway.discord.gg/?v=10
```

---

## Cross-References

- **Capture architecture** → [browser-integration.md](browser-integration.md)
- **L2 primitive schemas** → [layer2-interaction-primitives.md](layer2-interaction-primitives.md)
- **L3 adapter interface** → [layer3-code-adapters.md](layer3-code-adapters.md)
- **Plugin classification** → [pattern-library.md](pattern-library.md)
- **Runtime execution** → [runtime-executor.md](runtime-executor.md)
- **Package layout** → [skill-package-format.md](skill-package-format.md)
