# Adding a New Site

> How to create a new site fixture — from capture to verified skill package.
> Last updated: 2026-03-16 (commit: `dd2b17e`)

## Decision Tree

Before writing a fixture, determine the site's layer:

```
Does the site have a public REST/GraphQL API with API-key auth?
  └── Yes → L1 (direct_http) — no browser needed

Does standard cookie/token/header auth work?
  └── Yes → L2 (session_http or browser_fetch)
       │
       ├── Does the site check TLS fingerprint or need CORS context?
       │     └── Yes → browser_fetch mode
       │     └── No  → session_http mode
       │
       └── Which auth primitive?
             ├── Cookie-based login → cookie_session
             ├── JWT in localStorage → localStorage_jwt
             ├── Token in window global → page_global
             ├── Webpack module cache → webpack_module_walk
             └── Multi-step exchange → exchange_chain

None of the above work? Proprietary module system? Custom protocol?
  └── L3 adapter — write CodeAdapter
```

---

## Step 1: Create Fixture Directory

```bash
mkdir -p src/fixtures/<site>-fixture/tests
```

---

## Step 2: Capture Traffic (Optional)

If you want to auto-generate the spec:

```bash
# Start Chrome
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --no-first-run --user-data-dir=/tmp/openweb-chrome

# Browse to the site, log in

# Capture
pnpm dev capture start --cdp-endpoint http://localhost:9222
# Browse around, trigger the APIs you want
# Ctrl+C to stop

# Compile
pnpm dev compile <site-url>
```

Or write the spec by hand (recommended for precision).

---

## Step 3: Write openapi.yaml

### L1 Example (Open-Meteo)

```yaml
openapi: "3.1.0"
info:
  title: Open-Meteo
  version: "1.0.0"
servers:
  - url: https://api.open-meteo.com
paths:
  /v1/forecast:
    get:
      operationId: getForecast
      parameters:
        - name: latitude
          in: query
          required: true
          schema: { type: number }
        - name: longitude
          in: query
          required: true
          schema: { type: number }
```

### L2 Example (Instagram)

```yaml
openapi: "3.1.0"
info:
  title: Instagram Private API
  version: "1.0.0"
servers:
  - url: https://i.instagram.com
    x-openweb:
      mode: session_http
      auth:
        type: cookie_session
      csrf:
        type: cookie_to_header
        cookie: csrftoken
        header: X-CSRFToken
paths:
  /api/v1/feed/timeline/:
    post:
      operationId: getTimeline
      x-openweb:
        risk_tier: safe
        stable_id: instagram_getTimeline_v1
```

### L3 Example (WhatsApp)

```yaml
servers:
  - url: https://web.whatsapp.com
    x-openweb:
      mode: browser_fetch
paths:
  /getChats:
    get:
      operationId: getChats
      x-openweb:
        adapter:
          name: whatsapp
          operation: getChats
```

---

## Step 4: Write manifest.json

```json
{
  "name": "<site>",
  "version": "0.1.0",
  "spec_version": "0.1.0",
  "site": "<domain.com>",
  "generated_at": "2026-03-16T00:00:00Z",
  "requires_auth": true,
  "dependencies": {
    "playwright": "^1.52.0"
  }
}
```

---

## Step 5: Write Adapter (L3 Only)

Create `adapters/<name>.ts`:

```typescript
import type { CodeAdapter } from '../../../types/adapter.js';

const adapter: CodeAdapter = {
  name: '<name>',
  description: '<what it does>',
  provides: [{ type: 'extraction', description: '<capability>' }],

  async init(page) {
    // Verify page state, return true if ready
    return true;
  },

  async isAuthenticated(page) {
    // Check if user is logged in
    return true;
  },

  async execute(page, operation, params) {
    // Run the operation, return result
    switch (operation) {
      case 'getChats':
        return page.evaluate(() => { /* ... */ });
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  },
};

export default adapter;
```

---

## Step 6: Write Tests

Create `tests/<operationId>.test.json`:

```json
{
  "operationId": "getTimeline",
  "params": {},
  "expected": {
    "status": 200,
    "bodyContains": ["items"]
  }
}
```

---

## Step 7: Validate & Verify

```bash
# Build (compiles adapter .ts → .js)
pnpm build

# Run validation tests
pnpm test

# Verify with real browser
pnpm dev <site>-fixture exec <op> '{}' --cdp-endpoint http://localhost:9222

# Run site tests
pnpm dev <site>-fixture test
```

---

## Checklist

- [ ] `openapi.yaml` with correct x-openweb extensions
- [ ] `manifest.json` with correct metadata
- [ ] Adapter file (L3 only)
- [ ] Test cases in `tests/`
- [ ] `pnpm test` passes
- [ ] Real browser E2E verification
- [ ] Pitfalls documented in design docs (if applicable)

---

## Current Fixtures

| Fixture | Layer | Auth | CSRF | Key pattern |
|---------|-------|------|------|-------------|
| open-meteo | L1 | — | — | Public API |
| instagram | L2 | cookie_session | cookie_to_header | Classic cookie auth + CSRF |
| bluesky | L2 | localStorage_jwt | — | JWT from localStorage |
| youtube | L2 | page_global | — | Window global + SAPISIDHASH signing |
| github | L2 | cookie_session | meta_tag | DOM meta tag CSRF + SSR extraction |
| reddit | L2 | cookie_session | — | Cookie auth with .json API |
| discord | L2 | webpack_module_walk | — | Webpack module cache for auth token |
| whatsapp | L3 | adapter | — | Meta require() module system |
| telegram | L3 | adapter | — | teact global state |

---

## Related Docs

- [doc/main/primitives.md](../main/primitives.md) — Available L2 primitives
- [doc/main/adapters.md](../main/adapters.md) — L3 CodeAdapter interface
- [doc/main/meta-spec.md](../main/meta-spec.md) — x-openweb extension schema
- [doc/main/browser-capture.md](../main/browser-capture.md) — Capture module
