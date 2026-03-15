# Gap Coverage Matrix

> **Status**: COMPLETE
> **Purpose**: Maps each of the 12 design gaps to layers, primitives, and real examples.
> **Source**: `doc/todo/design_gap/001-012_*.md` + OpenTabs plugin analysis.

## Summary

| # | Gap | Primary Layer | L2 Primitives | Coverage | Plugin Count |
|---|---|---|---|---|---|
| 001 | Pure SSR / no client API | L2 | `html_selector`, `ssr_next_data`, `script_json`, `page_global_data` | Full | 12 |
| 002 | Browser state extraction | L2 | `localStorage_jwt`, `sessionStorage_*`, `page_global`, `webpack_module_walk` | Full | 60+ |
| 003 | WebSocket protocols | L2/L3 | `websocket_intercept` + AsyncAPI 3.x | Full | 5 |
| 004 | Dynamic request signing | L2/L3 | `sapisidhash`, `aws_sigv4`; L3 for obfuscated | Full | 7 |
| 005 | CSRF token rotation | L2 | `cookie_to_header`, `meta_tag`, `page_global`, `form_field`, `api_response` | Full | 33 |
| 006 | DOM parsing / SSR cache | L2 | `ssr_next_data`, `apollo_cache`, `script_json`, `page_global_data` | Full | 12 |
| 007 | No HTTP API | L3 | Code adapters (WhatsApp, Telegram) | Full | 3 |
| 008 | Multi-step auth exchange | L2 | `lazy_fetch`, `exchange_chain` | Full | 7 |
| 009 | Persisted query hashes | L2/L3 | L3 for webpack hash extraction | Full | 3 |
| 010 | Google gapi proxy | L2 | `gapi_proxy` | Full | 4 |
| 011 | Page navigation / DOM | L3 | Code adapters (UI automation) | Full | 2 |
| 012 | Cross-origin bearer | L2 | `sessionStorage_token`, multi-server config | Full | 5 |

**All 12 gaps are fully covered.** No gaps require architecture changes.

---

## Gap 001: Pure SSR / No Client API

**Severity**: HIGH — affects sites that serve complete HTML with no XHR/fetch.

**Layer**: L2 (extraction primitives)

**Primitives**:
- `html_selector` — DOM query for structured data in HTML
- `ssr_next_data` — Next.js `__NEXT_DATA__` global
- `ssr_nuxt` — Nuxt.js `__NUXT__` global
- `script_json` — JSON in `<script type="application/json">` tags
- `page_global_data` — Structured data in window globals

**Affected plugins**: Hacker News, Wikipedia, Airbnb, Zillow, Yelp, TikTok,
Booking, Google Maps, CircleCI, Walmart, GitHub (embedded data).

**OpenTabs approach** (Hacker News):
```typescript
// Hand-written DOM parsing
const stories = Array.from(document.querySelectorAll('tr.athing')).map(el => ({
  title: el.querySelector('.titleline > a')?.textContent,
  score: el.nextElementSibling?.querySelector('.score')?.textContent,
}));
```

**OpenWeb v2 approach**:
```yaml
extraction:
  type: html_selector
  page_url: "/news"
  selectors:
    title: ".titleline > a"
    score: ".score"
    author: ".hnuser"
  multiple: true
```

**Compiler detection**: HAR contains only HTML + static assets, no XHR/fetch.
Auto-detect SSR framework globals (`__NEXT_DATA__`, `__NUXT__`).

---

## Gap 002: Browser State Extraction

**Severity**: CRITICAL — most pervasive gap, affects 60+ plugins.

**Layer**: L2

**Primitives**:
- `localStorage_jwt` — JWT from localStorage (20 plugins)
- `sessionStorage_token` — token from sessionStorage (1 plugin)
- `sessionStorage_msal` — MSAL token scanning (5 plugins)
- `page_global` — token from `window.*` (30 plugins)
- `webpack_module_walk` — token from webpack internals (3 plugins)
- `websocket_intercept` — token from WebSocket frames (1 plugin)

**Affected plugins**: Bluesky, Discord, Netflix, npm, Sentry, YouTube, ClickUp,
Robinhood, Linear, Azure, Costco, and 50+ more.

**OpenTabs approach** (Bluesky):
```typescript
const raw = localStorage.getItem('BSKY_STORAGE');
const parsed = JSON.parse(raw);
const token = parsed.session.currentAccount.accessJwt;
headers['Authorization'] = `Bearer ${token}`;
```

**OpenWeb v2 approach**:
```yaml
auth:
  type: localStorage_jwt
  key: BSKY_STORAGE
  path: session.currentAccount.accessJwt
  inject:
    header: Authorization
    prefix: "Bearer "
```

**Compiler detection**: Cross-reference captured `Authorization` header values
against state snapshots (localStorage, sessionStorage, cookies, globals).
High-confidence auto-detection.

---

## Gap 003: WebSocket Protocols

**Severity**: CRITICAL for real-time sites.

**Layer**: L2 (auth interception) + L1 (AsyncAPI for message schemas)

**Primitives**: `websocket_intercept` for auth token capture.
AsyncAPI 3.x for message schema description.

**Affected plugins**: Discord, ClickUp, Slack.
L3 for: WhatsApp, Telegram (non-standard internal protocols).

**OpenTabs approach** (ClickUp):
```typescript
const OrigSend = WebSocket.prototype.send;
WebSocket.prototype.send = function(data) {
  const parsed = JSON.parse(data);
  if (parsed.method === 'auth' && parsed.token) {
    globalThis.__cu_captured_jwt = parsed.token;
  }
  return OrigSend.call(this, data);
};
```

**OpenWeb v2 approach**:
```yaml
auth:
  type: websocket_intercept
  frame_match:
    field: method
    value: auth
  extract: token
  inject:
    header: Authorization
    prefix: "Bearer "
  timeout: 15000
```

**Capture**: CDP `Network.webSocketFrame*` events → JSONL recording.
**Spec**: AsyncAPI 3.x for structured WS message schemas (Discord gateway).

---

## Gap 004: Dynamic Request Signing

**Severity**: CRITICAL for Google services and security-sensitive sites.

**Layer**: L2 for known algorithms, L3 for obfuscated signing.

**L2 Primitives**:
- `sapisidhash` — Google SHA-1 signing (YouTube, Google Analytics, etc.)
- `aws_sigv4` — AWS request signing (AWS Console)
- `gapi_proxy` — delegate to Google's `gapi.client.request()`

**L3 Adapters** (obfuscated, non-parameterizable):
- OnlyFans — webpack module 977434 `JA` function
- TikTok — `byted_acrawler.frontierSign()` for X-Bogus
- minimax-agent — Axios HMAC via webpack module 33993

**OpenTabs approach** (YouTube):
```typescript
const ts = Math.floor(Date.now() / 1000);
const input = `${ts} ${sapisid} ${origin}`;
const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
headers['Authorization'] = `SAPISIDHASH ${ts}_${hexHash}`;
```

**OpenWeb v2 approach**:
```yaml
signing:
  type: sapisidhash
  origin: "https://www.youtube.com"
  inject:
    header: Authorization
    prefix: "SAPISIDHASH "
```

**80/20 split**: SAPISIDHASH + SigV4 + gapi_proxy cover 7 of 10 signing sites
as L2. The remaining 3 (OnlyFans, TikTok, minimax) need L3 adapters that call
the site's own obfuscated functions.

---

## Gap 005: CSRF Token Rotation

**Severity**: HIGH — affects 33 sites.

**Layer**: L2

**Primitives**:
- `cookie_to_header` — cookie value → header (16 plugins)
- `page_global` — window global → header or body (9 plugins)
- `meta_tag` — `<meta>` tag → header (5 plugins)
- `form_field` — hidden input → header or body (2 plugins)
- `api_response` — API call → extract field (1 plugin)

**OpenTabs approach** (Instagram):
```typescript
const csrfToken = getCookie('csrftoken');
headers['X-CSRFToken'] = csrfToken;
```

**OpenWeb v2 approach**:
```yaml
csrf:
  type: cookie_to_header
  cookie: csrftoken
  header: X-CSRFToken
```

**Compiler detection**: Compare non-HttpOnly cookie values against request
headers on mutation endpoints. Exact-match correlation → `cookie_to_header`.

---

## Gap 006: DOM Parsing / SSR Cache

**Severity**: HIGH — affects SSR-heavy sites.

**Layer**: L2

**Primitives**:
- `ssr_next_data` — Next.js (Zillow, CircleCI, Walmart)
- `apollo_cache` — Apollo Client cache (Netflix, Instacart, Medium)
- `script_json` — JSON in script tags (Airbnb, GitHub)
- `page_global_data` — window globals (Yelp, TikTok, Booking, Google Maps)

**OpenTabs approach** (Airbnb):
```typescript
const script = document.querySelector('script[id="data-deferred-state-0"]');
const data = JSON.parse(script.textContent);
const listing = data.niobeMinimalClientData[0][1].data.presentation;
```

**OpenWeb v2 approach**:
```yaml
extraction:
  type: script_json
  selector: 'script[type="application/json"][id="data-deferred-state-0"]'
  path: "niobeMinimalClientData[0][1].data.presentation"
```

---

## Gap 007: No HTTP API

**Severity**: CRITICAL for affected sites (but rare — 3 sites).

**Layer**: L3 (code adapters only)

**Affected plugins**: WhatsApp, Telegram, (partially) Facebook.

These sites have no REST/GraphQL API. All data access goes through internal
module systems (WhatsApp `require()`, Telegram `apiManager.invokeApi()`).

**Solution**: L3 code adapters that call internal APIs directly.
Virtual endpoints in `openapi.yaml` map to adapter operations.

```yaml
# whatsapp/openapi.yaml
paths:
  /internal/chats:
    get:
      operationId: getChats
      x-openweb:
        mode: browser_fetch
        adapter:
          name: whatsapp-modules
          operation: getChats
```

See [layer3-code-adapters.md](layer3-code-adapters.md) for full adapter implementations.

**Limitation**: Adapter code is site-specific and must be updated when the site
changes its internal module structure. Self-healing can detect breakage but
cannot auto-fix L3 adapters.

---

## Gap 008: Multi-Step Auth Exchange

**Severity**: HIGH for enterprise platforms.

**Layer**: L2

**Primitives**:
- `lazy_fetch` — token fetched on-demand (ChatGPT, Docker Hub, Twilio, Spotify)
- `exchange_chain` — multi-step exchange (Reddit, Teams, AWS Console)

**OpenTabs approach** (Reddit):
```typescript
const csrfToken = getCookie('csrf_token');
const response = await fetch('/svc/shreddit/token', {
  method: 'POST',
  body: JSON.stringify({ csrf_token: csrfToken }),
});
const { token, expires } = await response.json();
headers['Authorization'] = `Bearer ${token}`;
```

**OpenWeb v2 approach**:
```yaml
auth:
  type: exchange_chain
  steps:
    - call: POST https://www.reddit.com/svc/shreddit/token
      body:
        csrf_token: "${cookie:csrf_token}"
      extract: token
      expires_field: expires
  refresh_before: 30s
  inject:
    header: Authorization
    prefix: "Bearer "
```

---

## Gap 009: Persisted Query Hashes

**Severity**: HIGH for GraphQL-heavy sites.

**Layer**: L2 for standard persisted queries, L3 for webpack-bundled hashes.

**Affected plugins**: GitHub, Instacart, X/Twitter, Spotify.

**L2 handling**: When `PersistedQueryNotFound` error occurs, runtime can
fall back to sending the full query string (if available in the spec).

**L3 handling**: Instacart extracts hashes from webpack module 47096 at
runtime. The L3 adapter probes the chunk array, finds the module, executes
it, and returns the hash map.

**Limitation**: Hash maps expire on each deployment. L3 adapters with
fallback hashes provide resilience but may need periodic updates.

---

## Gap 010: Google gapi Proxy

**Severity**: CRITICAL for Google services (4 plugins).

**Layer**: L2

**Primitive**: `gapi_proxy` — delegate request to `gapi.client.request()`.

**Affected plugins**: Google Analytics, Google Calendar, Google Drive, Google Cloud.

**OpenTabs approach** (Google Analytics):
```typescript
const client = gapi.client;
client.setApiKey(apiKey);
const result = await client.request({ path, method, params, body });
```

**OpenWeb v2 approach**:
```yaml
signing:
  type: gapi_proxy
  api_key:
    source: page_global
    expression: "preload.globals.gmsSuiteApiKey"
  authuser:
    source: page_global
    expression: "preload.globals.authuser"
```

**Runtime**: Forces `mode: browser_fetch`. All requests routed through
`gapi.client.request()` in page context, which handles SAPISIDHASH internally.

---

## Gap 011: Page Navigation / DOM Side Effects

**Severity**: MEDIUM — rare (2 sites).

**Layer**: L3

**Affected plugins**: WhatsApp (message sending via UI automation),
sites requiring BroadcastChannel or postMessage for cross-tab communication.

**Solution**: L3 adapters can interact with the DOM via `page` object
(click, type, waitForSelector). WhatsApp's `sendMessage` opens a chat,
pastes text, and presses Enter.

**Limitation**: UI automation is fragile. DOM selectors break when the
site updates its UI. Self-healing can detect breakage but auto-repair
requires rewriting selector logic.

---

## Gap 012: Cross-Origin Bearer

**Severity**: MEDIUM-HIGH — affects multi-domain sites.

**Layer**: L2

**Primitives**: `sessionStorage_token` + multi-server OpenAPI config.

**Affected plugins**: Costco (3 API domains), Azure (ARM API), Bluesky
(user PDS), Robinhood (4 API domains), ClickHouse.

**OpenTabs approach** (Costco):
```typescript
const hashedUserId = getCookie('hashedUserId');
const token = sessionStorage.getItem(`authToken_${hashedUserId}`);
headers['Authorization'] = `Bearer ${token}`;
// Used across ecom-api.costco.com, api.digital.costco.com, geocodeservice.costco.com
```

**OpenWeb v2 approach**: Multiple servers in OpenAPI, each with its own auth:
```yaml
servers:
  - url: https://www.costco.com
    x-openweb:
      auth: { type: cookie_session }
  - url: https://api.digital.costco.com
    x-openweb:
      auth:
        type: sessionStorage_token
        key: "authToken_${cookie:hashedUserId}"
        inject: { header: Authorization, prefix: "Bearer " }
  - url: https://ecom-api.costco.com
    x-openweb:
      auth: { type: cookie_session }
```

OpenAPI 3.1 natively supports per-operation `servers` overrides, so each
endpoint can reference the correct server + auth config.

---

## Gaps → Documents Traceability

| Gap | Primary docs |
|---|---|
| 001 | [layer2-interaction-primitives.md](layer2-interaction-primitives.md) (extraction), [compiler-pipeline.md](compiler-pipeline.md) (detection) |
| 002 | [layer2-interaction-primitives.md](layer2-interaction-primitives.md) (auth), [browser-integration.md](browser-integration.md) (state capture) |
| 003 | [browser-integration.md](browser-integration.md) (WebSocket JSONL), [layer2-interaction-primitives.md](layer2-interaction-primitives.md) (websocket_intercept) |
| 004 | [layer2-interaction-primitives.md](layer2-interaction-primitives.md) (signing), [layer3-code-adapters.md](layer3-code-adapters.md) (obfuscated) |
| 005 | [layer2-interaction-primitives.md](layer2-interaction-primitives.md) (CSRF), [compiler-pipeline.md](compiler-pipeline.md) (detection) |
| 006 | [layer2-interaction-primitives.md](layer2-interaction-primitives.md) (extraction), [browser-integration.md](browser-integration.md) (DOM capture) |
| 007 | [layer3-code-adapters.md](layer3-code-adapters.md) (WhatsApp, Telegram adapters) |
| 008 | [layer2-interaction-primitives.md](layer2-interaction-primitives.md) (exchange_chain, lazy_fetch) |
| 009 | [layer3-code-adapters.md](layer3-code-adapters.md) (Instacart hash extraction) |
| 010 | [layer2-interaction-primitives.md](layer2-interaction-primitives.md) (gapi_proxy) |
| 011 | [layer3-code-adapters.md](layer3-code-adapters.md) (UI automation) |
| 012 | [layer2-interaction-primitives.md](layer2-interaction-primitives.md) (sessionStorage_token), [skill-package-format.md](skill-package-format.md) (multi-server) |
