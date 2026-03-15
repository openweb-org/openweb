# Runtime Executor v2

> **Status**: DRAFT
> **Evolved from**: v1 (`archive/v1/compiler-output-and-runtime.md`)
> **Addresses**: All layers — orchestrates L1+L2+L3 execution

## Overview

The runtime executor reads an OpenAPI spec with `x-openweb` extensions and
executes operations. v2 adds L2 primitive execution and L3 adapter execution
on top of v1's mode escalation and CLI-first design.

```
Agent calls: openweb exec bluesky getTimeline --limit 50
                │
                ▼
        ┌── Read OpenAPI operation + x-openweb ──┐
        │                                         │
        │  1. Resolve L2 auth     (extract token) │
        │  2. Resolve L2 csrf     (if mutation)    │
        │  3. Resolve L2 signing  (if configured)  │
        │  4. Run L3 adapter      (if configured)  │
        │  5. Make HTTP request                    │
        │  6. Handle errors / retry / escalate     │
        │  7. Resolve L2 pagination (if requested) │
        │                                         │
        └── Return JSON to stdout ────────────────┘
```

---

## CLI Interface (unchanged from v1)

Progressive spec navigation — agents discover at low token cost:

```bash
openweb sites                              # ~50 tokens: list all sites
openweb bluesky                            # ~200 tokens: list operations
openweb bluesky getTimeline                # ~150 tokens: parameters + response
openweb bluesky exec getTimeline '{...}'   # execute, return JSON
```

**Token cost**: ~400 tokens total vs ~5000 for full MCP schema upfront.

---

## Execution Modes

Three modes, determined by `x-openweb.mode` on the server or operation:

| Mode | Transport | Browser needed | When |
|---|---|---|---|
| `direct_http` | HTTP client | No | Public APIs, API-key auth |
| `session_http` | HTTP client + cookies | For extraction only | Cookie auth, CSRF tokens |
| `browser_fetch` | `page.evaluate(fetch(...))` | Yes (full page context) | Signing, gapi, L3 adapters |

### Mode Requirements by L2 Primitive

| Primitive | Minimum mode | Why |
|---|---|---|
| `cookie_session` | `session_http` | Need cookies from browser |
| `localStorage_jwt` | `session_http` | Extract from browser, then HTTP |
| `sessionStorage_*` | `session_http` | Extract from browser, then HTTP |
| `page_global` | `session_http` | `page.evaluate()` to read global |
| `webpack_module_walk` | `browser_fetch` | Complex page-context JS execution |
| `websocket_intercept` | `browser_fetch` | Must patch WebSocket.prototype |
| `lazy_fetch` | `session_http` | Fetch from auth endpoint with cookies |
| `exchange_chain` | `session_http` | Multi-step HTTP with cookies |
| `cookie_to_header` | `session_http` | Read cookie via `document.cookie` |
| `meta_tag` | `session_http` | DOM query for meta tag |
| `page_global` (csrf) | `session_http` | `page.evaluate()` |
| `form_field` | `session_http` | Fetch + DOM parse |
| `api_response` | `session_http` | HTTP call with cookies |
| `sapisidhash` | `browser_fetch` | `crypto.subtle` + live SAPISID cookie |
| `gapi_proxy` | `browser_fetch` | Must call `gapi.client.request()` in page |
| `aws_sigv4` | `session_http` | Pure computation (no browser) |
| L3 adapter | `browser_fetch` | Always runs in page context |

---

## Execution Pipeline

### Step 1: Read Operation

```typescript
async function executeOperation(
  site: string,
  operationId: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const spec = loadOpenApiSpec(site);
  const { operation, server } = resolveOperation(spec, operationId);
  const xopenweb = {
    ...server['x-openweb'],       // server-level defaults
    ...operation['x-openweb'],    // operation-level overrides
  };
```

### Step 2: Resolve L2 Auth

Extract auth token(s) based on the configured primitive:

```typescript
  const mode = xopenweb.mode;
  const headers: Record<string, string> = {};
  const queryParams: Record<string, string> = {};
  let bodyExtras: Record<string, unknown> = {};

  if (xopenweb.auth) {
    const authResult = await resolveAuth(xopenweb.auth, page, mode);
    // Apply injections
    for (const injection of authResult.injections) {
      if (injection.header) {
        headers[injection.header] = (injection.prefix ?? '') + injection.value;
      }
      if (injection.query) queryParams[injection.query] = injection.value;
      if (injection.body_field) bodyExtras[injection.body_field] = injection.value;
    }
  }
```

**Auth resolver dispatch** (one handler per type):

```typescript
async function resolveAuth(
  config: AuthPrimitive,
  page: Page | null,
  mode: string,
): Promise<AuthResult> {
  switch (config.type) {
    case 'cookie_session':
      return { injections: [] }; // credentials: include handles it

    case 'localStorage_jwt':
      const token = await page!.evaluate(
        ([key, path]) => {
          const raw = localStorage.getItem(key);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          return path.split('.').reduce((o: any, k: string) => o?.[k], parsed);
        },
        [config.key, config.path ?? ''],
      );
      if (!token) throw new ToolError('auth', 'Token not found in localStorage');
      return { injections: [{ ...config.inject, value: token }] };

    case 'page_global':
      const value = await page!.evaluate(
        (expr) => expr.split('.').reduce((o: any, k: string) => o?.[k], window),
        config.expression,
      );
      if (!value) throw new ToolError('auth', 'Global not found');
      const injections = [{ ...config.inject, value: String(value) }];
      // Handle additional values
      for (const extra of config.values ?? []) {
        const v = await page!.evaluate(
          (expr) => expr.split('.').reduce((o: any, k: string) => o?.[k], window),
          extra.expression,
        );
        if (v) injections.push({ ...extra.inject, value: String(v) });
      }
      return { injections };

    case 'lazy_fetch':
      // Check cache first
      if (tokenCache.has(config.endpoint) && config.cache !== false) {
        return { injections: [{ ...config.inject, value: tokenCache.get(config.endpoint)! }] };
      }
      const res = await fetchWithCookies(config.endpoint, { method: config.method ?? 'GET' });
      const data = await res.json();
      const extracted = walkPath(data, config.extract);
      tokenCache.set(config.endpoint, extracted);
      return { injections: [{ ...config.inject, value: extracted }] };

    // ... other types follow same pattern
  }
}
```

### Step 3: Resolve L2 CSRF

Only for mutation methods (POST, PUT, DELETE, PATCH):

```typescript
  const method = operation.method.toUpperCase();
  const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

  if (xopenweb.csrf && isMutation) {
    const csrfResult = await resolveCsrf(xopenweb.csrf, page, mode);
    for (const injection of csrfResult.injections) {
      if (injection.header) headers[injection.header] = injection.value;
      if (injection.body_field) bodyExtras[injection.body_field] = injection.value;
    }
  }
```

### Step 4: Resolve L2 Signing

Per-request computation (runs on every request, not cached):

```typescript
  if (xopenweb.signing) {
    switch (xopenweb.signing.type) {
      case 'sapisidhash': {
        const hash = await page!.evaluate(async ([origin]) => {
          const ts = Math.floor(Date.now() / 1000);
          const sapisid = document.cookie.split(';')
            .find(c => c.trim().startsWith('SAPISID='))
            ?.split('=')[1];
          if (!sapisid) throw new Error('SAPISID cookie not found');
          const input = `${ts} ${sapisid} ${origin}`;
          const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
          const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
          return `${ts}_${hex}`;
        }, [xopenweb.signing.origin]);
        const inject = xopenweb.signing.inject;
        headers[inject.header!] = (inject.prefix ?? '') + hash;
        break;
      }
      case 'gapi_proxy':
        // Entire request delegated to gapi — handled in Step 5
        break;
      case 'aws_sigv4':
        // SigV4 signing — pure computation, no browser needed
        const signed = awsSigV4Sign(requestUrl, method, headers, body, xopenweb.signing);
        Object.assign(headers, signed);
        break;
    }
  }
```

### Step 5: Run L3 Adapter (if configured)

```typescript
  if (xopenweb.adapter) {
    const adapter = loadAdapter(site, xopenweb.adapter.name);
    const adapterResult = await adapter.execute(
      page!,
      xopenweb.adapter.operation,
      { ...params, ...xopenweb.adapter.params },
    );

    // If adapter handles the entire operation (WhatsApp, Telegram):
    if (xopenweb.mode === 'browser_fetch' && !operation.servers) {
      return adapterResult;
    }

    // If adapter provides signing headers (OnlyFans, TikTok):
    if (typeof adapterResult === 'object' && adapterResult !== null) {
      Object.assign(headers, adapterResult);
    }
  }
```

### Step 6: Make HTTP Request

```typescript
  const requestUrl = buildUrl(server.url, operation.path, params, queryParams);

  let response: Response;
  if (mode === 'browser_fetch' || xopenweb.signing?.type === 'gapi_proxy') {
    // Execute in browser page context
    response = await page!.evaluate(async ([url, init]) => {
      const res = await fetch(url, {
        ...init,
        credentials: 'include',
      });
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers),
        body: await res.text(),
      };
    }, [requestUrl, { method, headers, body: JSON.stringify(bodyExtras) }]);
  } else if (mode === 'session_http') {
    // HTTP client with cookie jar from browser
    const cookies = await context.cookies();
    response = await httpFetch(requestUrl, { method, headers, body: bodyExtras, cookies });
  } else {
    // direct_http — plain HTTP
    response = await httpFetch(requestUrl, { method, headers, body: bodyExtras });
  }
```

### Step 7: Handle Errors + Escalation

```typescript
  if (response.status === 401 || response.status === 403) {
    // Clear auth cache
    tokenCache.clear();

    // Retry with token refresh
    if (xopenweb.auth?.type === 'lazy_fetch') {
      tokenCache.delete(xopenweb.auth.endpoint);
      return executeOperation(site, operationId, params); // retry once
    }

    // Escalate mode
    if (mode === 'direct_http') return retryWithMode('session_http');
    if (mode === 'session_http') return retryWithMode('browser_fetch');
    throw new ToolError('auth', 'Authentication failed after escalation');
  }

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers['retry-after'] ?? '5');
    throw new ToolError('rate_limited', `Rate limited, retry after ${retryAfter}s`, true);
  }

  if (response.status >= 500) {
    throw new ToolError('internal', `Server error: ${response.status}`, true);
  }

  return JSON.parse(response.body);
}
```

---

## Pagination Execution

When the agent requests paginated results, the executor handles the cursor loop:

```typescript
async function executePaginated(
  site: string,
  operationId: string,
  params: Record<string, unknown>,
  maxPages: number = 10,
): Promise<unknown[]> {
  const spec = loadOpenApiSpec(site);
  const { operation } = resolveOperation(spec, operationId);
  const pagination = operation['x-openweb']?.pagination;
  if (!pagination) return [await executeOperation(site, operationId, params)];

  const results: unknown[] = [];
  let cursor: string | null = null;

  for (let i = 0; i < maxPages; i++) {
    const pageParams = cursor
      ? { ...params, [pagination.request_param]: cursor }
      : params;

    const result = await executeOperation(site, operationId, pageParams) as any;
    results.push(result);

    // Extract next cursor
    cursor = walkPath(result, pagination.response_field);
    if (!cursor) break;

    // Check has_more flag if configured
    if (pagination.has_more_field) {
      const hasMore = walkPath(result, pagination.has_more_field);
      if (!hasMore) break;
    }
  }
  return results;
}
```

---

## Session Management

### Browser Session Lifecycle

The executor manages a background browser daemon for `session_http` and
`browser_fetch` modes:

```
First L2/L3 call
  │
  ▼
Start browser daemon (if not running)
  │
  ▼
Connect via CDP (connectOverCDP)
  │
  ▼
Navigate to site (if page not loaded)
  │
  ▼
Execute L2 primitives + HTTP request
  │
  ▼
Keep daemon alive (5-min idle timeout)
  │
  ▼
Auto-exit after idle timeout
```

For `direct_http` endpoints, the daemon is never started.

### Cookie Jar

- Extracted from browser context: `context.cookies()`
- Used for `session_http` requests without full browser overhead
- Invalidated on 401/403 (triggers re-extraction from browser)

### Token Cache

- Per-site, in-memory cache of extracted auth tokens
- Keys: `${auth_type}:${config_key}` (e.g., `localStorage_jwt:BSKY_STORAGE`)
- Cleared on auth errors (401, 403)
- TTL: token-specific (e.g., `exchange_chain` tokens have `refresh_before`)

---

## Error Contract

JSON on stderr, matching v1:

```typescript
interface ToolError {
  error_code: 'auth' | 'validation' | 'not_found' | 'rate_limited' | 'timeout' | 'internal';
  message: string;
  retryable: boolean;
  action_hint?: string;
  context?: {
    mode: string;
    operation: string;
    http_status?: number;
  };
}
```

**Exit codes**: 0 = success, 1 = error (JSON on stderr).

---

## Rate Limiting

Per risk tier, enforced by the executor:

| Risk Tier | Rate Limit | Confirmation |
|---|---|---|
| `safe` | 120 req/min | None |
| `low` | 60 req/min | None |
| `medium` | 30 req/min | Once per session |
| `high` | 10 req/min | Every call |
| `critical` | 5 req/min | Every call + explicit confirmation |

Enforcement: sliding window counter per `(site, operationId)`. On limit
exceeded, return `rate_limited` error with `retry_after`.

---

## SSRF Protection

The executor validates all URLs before making requests:

```typescript
function validateUrl(url: string, allowedServers: string[]): void {
  const parsed = new URL(url);

  // Block private/internal IPs
  if (isPrivateIP(parsed.hostname)) {
    throw new ToolError('validation', `SSRF blocked: ${parsed.hostname} is private`);
  }

  // Block non-HTTPS in production
  if (parsed.protocol !== 'https:' && !isDev()) {
    throw new ToolError('validation', 'Only HTTPS allowed');
  }

  // Verify against declared servers
  const matchesServer = allowedServers.some(s => url.startsWith(s));
  if (!matchesServer) {
    throw new ToolError('validation', `URL ${url} not in declared servers`);
  }
}
```

---

## Execution Examples

### Bluesky getTimeline (L2: localStorage_jwt + cursor pagination)

```
1. Read operation: GET /app.bsky.feed.getTimeline
2. Auth: localStorage_jwt → page.evaluate() → extract accessJwt
3. CSRF: none
4. Signing: none
5. HTTP: GET https://bsky.social/xrpc/app.bsky.feed.getTimeline?limit=50
   Headers: { Authorization: "Bearer eyJ..." }
6. Response: { cursor: "abc123", feed: [...] }
7. Pagination: cursor=abc123 → next request
```

### Instagram likeMedia (L2: cookie_session + cookie_to_header CSRF)

```
1. Read operation: POST /media/{media_id}/like/
2. Auth: cookie_session → credentials: include
3. CSRF: cookie_to_header → read csrftoken cookie → set X-CSRFToken header
4. Signing: none
5. HTTP: POST https://www.instagram.com/api/v1/media/123/like/
   Headers: { X-CSRFToken: "abc123", Cookie: "sessionid=...; csrftoken=abc123" }
6. Response: { status: "ok" }
```

### YouTube search (L2: page_global auth + SAPISIDHASH signing)

```
1. Read operation: POST /search
2. Auth: page_global → extract INNERTUBE_API_KEY + SESSION_INDEX
3. CSRF: none
4. Signing: sapisidhash → SHA1(ts + SAPISID + origin) → Authorization header
5. HTTP: POST https://www.youtube.com/youtubei/v1/search?key=AIza...
   Headers: { Authorization: "SAPISIDHASH 1710..._a3f2...", X-Goog-AuthUser: "0" }
   Body: { context: {...}, query: "cats" }
6. Response: { contents: [...] }
```

### OnlyFans getUser (L2 auth + L3 signing adapter)

```
1. Read operation: GET /api2/v2/users/{userId}
2. Auth: cookie_session (Vuex store for auth detection)
3. CSRF: page_global → Vuex CSRF token
4. L3 adapter: onlyfans-signing.signRequest({ url: "/api2/v2/users/123" })
   → returns { sign: "...", time: "...", x-bc: "...", x-hash: "..." }
5. HTTP: GET https://onlyfans.com/api2/v2/users/123
   Headers: { sign: "...", time: "...", x-bc: "...", x-hash: "...", Cookie: "..." }
6. Response: { id: 123, name: "..." }
```

### WhatsApp getChats (pure L3 — no HTTP)

```
1. Read operation: GET /internal/chats
2. L3 adapter: whatsapp-modules.getChats()
   → page.evaluate() → require('WAWebChatCollection').ChatCollection.getModelsArray()
   → serialize and return
3. Response: [{ id: "123@s.whatsapp.net", name: "Alice", ... }]
```

---

## Self-Healing

When a previously working endpoint starts failing:

1. **Detect**: Response doesn't match expected schema, or unexpected 4xx/5xx
2. **Diagnose**: Compare current site fingerprint against stored fingerprint
3. **Escalate**: Try higher execution mode (direct_http → session_http → browser_fetch)
4. **Flag**: If escalation doesn't fix it, mark operation as `needs_recompilation`
5. **Recompile**: Agent can trigger `openweb compile <site>` to regenerate spec

Fingerprint comparison uses `manifest.json` hashes (js_bundle_hash,
api_endpoint_set_hash, response_shape_hash).

---

## Cross-References

- **L2 primitive schemas** → [layer2-interaction-primitives.md](layer2-interaction-primitives.md)
- **L3 adapter interface** → [layer3-code-adapters.md](layer3-code-adapters.md)
- **Browser connection** → [browser-integration.md](browser-integration.md)
- **Compiler output** → [compiler-pipeline.md](compiler-pipeline.md): Phase 4 produces what the executor consumes
- **Package format** → [skill-package-format.md](skill-package-format.md)
- **Risk tiers** → [security-taxonomy.md](security-taxonomy.md)
