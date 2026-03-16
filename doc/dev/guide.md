# OpenWeb — Dev Guide

> **Last updated**: 2026-03-16 (post-M3)

## Tech Stack

| Component | Tool | Version |
|---|---|---|
| Language | TypeScript (strict, no `any`) | ES2022 |
| Runtime | Node.js | 20+ |
| Build | tsup (ESM → dist/) | 8.x |
| Test | Vitest | 3.x |
| Lint | Biome | 1.x |
| CLI | yargs | 18.x |
| Browser | Playwright | 1.52+ |
| Schema | AJV | 8.x |
| Package mgr | pnpm | - |

## Project Structure

```
src/
├── cli.ts                    # Entry point, yargs routing
├── commands/                 # CLI commands (capture, compile, exec, show, sites, test)
├── capture/
│   ├── session.ts            # Capture lifecycle orchestrator
│   ├── har-capture.ts        # HTTP traffic capture + filtering
│   ├── ws-capture.ts         # WebSocket frame capture via CDP
│   ├── state-capture.ts      # localStorage, sessionStorage, cookies
│   ├── dom-capture.ts        # Meta tags, hidden inputs, framework globals
│   ├── bundle.ts             # Write capture bundle to disk
│   ├── connection.ts         # CDP connection with retry
│   └── types.ts              # Capture type definitions
├── compiler/
│   ├── recorder.ts           # HAR/metadata parsing
│   ├── generator.ts          # OpenAPI + manifest emission (L1 + L2 classify)
│   └── analyzer/             # cluster → filter → differentiate → schema → annotate → classify
├── runtime/
│   ├── executor.ts           # Operation execution (direct_http + session_http + browser_fetch dispatch)
│   ├── session-executor.ts   # session_http mode: CDP browser + L2 primitive resolution
│   ├── browser-fetch-executor.ts # browser_fetch mode: page.evaluate(fetch(...))
│   ├── adapter-executor.ts   # L3 adapter loading + init/auth/execute lifecycle
│   ├── paginator.ts          # Pagination executor (cursor + link_header)
│   ├── token-cache.ts        # Token cache with TTL for auth primitives
│   ├── navigator.ts          # CLI navigation helper
│   └── primitives/           # L2 primitive resolvers
│       ├── types.ts          # BrowserHandle, ResolvedInjections
│       ├── cookie-session.ts # cookie_session auth (extract all cookies)
│       ├── cookie-to-header.ts # cookie_to_header CSRF (cookie → header)
│       ├── localstorage-jwt.ts # localStorage_jwt auth
│       ├── page-global.ts    # page_global auth/CSRF (window globals)
│       ├── sapisidhash.ts    # SAPISIDHASH signing (Google)
│       ├── meta-tag.ts       # meta_tag CSRF (DOM meta element)
│       ├── api-response.ts   # api_response CSRF (fetch from endpoint)
│       ├── exchange-chain.ts # exchange_chain auth (multi-step token exchange)
│       ├── script-json.ts    # script_json extraction (SSR JSON in <script>)
│       ├── webpack-module-walk.ts # webpack_module_walk auth (webpack module cache)
│       └── primitives.test.ts # L2 primitive unit tests
├── types/
│   ├── primitives.ts         # L2 primitive discriminated unions (27 types)
│   ├── primitive-schemas.ts  # JSON Schema for L2 primitives (AJV)
│   ├── extensions.ts         # XOpenWebServer, XOpenWebOperation types
│   ├── manifest.ts           # Manifest type
│   ├── adapter.ts            # CodeAdapter interface
│   ├── schema.ts             # Composite JSON Schema (server/operation/manifest)
│   ├── validator.ts          # AJV-based x-openweb + manifest validation
│   ├── validator.test.ts     # Validation tests
│   └── index.ts              # Re-exports
├── lib/
│   ├── errors.ts             # Structured error contract
│   ├── openapi.ts            # OpenAPI parsing, URL building
│   └── ssrf.ts               # SSRF validation (IPv4/v6, DNS, metadata)
└── fixtures/
    ├── open-meteo-fixture/   # L1 test fixture (no x-openweb primitives)
    ├── instagram-fixture/    # L2 test fixture (cookie_session + cookie_to_header)
    ├── bluesky-fixture/      # L2 test fixture (localStorage_jwt)
    ├── youtube-fixture/      # L2 test fixture (page_global + sapisidhash)
    ├── github-fixture/       # L2 test fixture (meta_tag CSRF + script_json extraction)
    └── reddit-fixture/       # L2 test fixture (cookie_session — www.reddit.com/.json API)
    ├── discord-fixture/      # L2 test fixture (webpack_module_walk + browser_fetch)
    ├── whatsapp-fixture/     # L3 test fixture (adapter — Meta require() module system)
    └── telegram-fixture/     # L3 test fixture (adapter — teact global state via webpack)
```

## Commands

```bash
pnpm build          # tsup → dist/ + compile adapters .ts→.js
pnpm test           # vitest (167/167 pass)
pnpm lint           # biome check
```

## Current Implementation Status

**Working (L1 + M0 capture + M1 meta-spec + M2 session_http + M3 L2 breadth)**:
- CLI: `sites` → `show` → `exec` → `test` full flow
- CLI: `capture start/stop` — browser capture via CDP
- Compiler phases 2-4: filter → cluster → differentiate → schema → annotate → emit
- Compiler: Classify step detects cookie_session + cookie_to_header from capture data
- Compiler: generator emits server-level x-openweb (mode + auth + csrf) with ClassifyResult
- Runtime: `direct_http` mode with SSRF protection, redirect handling, schema validation
- Runtime: `session_http` mode — CDP browser connection, cookie auth, CSRF token injection
- Runtime: `browser_fetch` mode — CDP browser + `page.evaluate(fetch(...))` for browser-context requests
- Runtime: L3 adapter framework — CodeAdapter loading + init/auth/execute lifecycle
- Runtime: L2 primitive resolvers (10 handlers): cookie_session, cookie_to_header, localStorage_jwt, page_global, sapisidhash, meta_tag, api_response, exchange_chain, script_json, webpack_module_walk
- Runtime: Redirect following with cross-origin header stripping, method rewriting (303)
- Runtime: Pagination executor: cursor + link_header modes with max page safety
- Runtime: Token cache with configurable TTL and lazy expiry
- Runtime: Request body construction for POST/PUT/PATCH (JSON serialization, 303 drop)
- Capture: HAR + WebSocket + state snapshots + DOM extraction (4 sources)
- Error contract: EXECUTION_FAILED, TOOL_NOT_FOUND, INVALID_PARAMS
- Types: L2 primitive types (27 types), x-openweb extensions, manifest, CodeAdapter
- Validation: AJV-based x-openweb spec + manifest.json validation
- M3 verified sites: Instagram, Bluesky, YouTube, GitHub, Reddit (5 sites, 9 primitive types)
- M4 verified sites: Discord (webpack_module_walk + browser_fetch), WhatsApp (L3 adapter), Telegram (L3 adapter)

**Not yet implemented (v2 additions)**:
- Additional L2 primitive handlers (sessionStorage_msal, websocket_intercept, etc.)
- Mode escalation (direct → session → browser)
- Phase 3 mode probing (empirical testing)

-> See: [doc/todo/note.md](../todo/note.md) — roadmap (M0-M5)

## Browser Capture (M0)

### Usage

```bash
# 1. Start Chrome with remote debugging
google-chrome --remote-debugging-port=9222
# macOS:
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --no-first-run --user-data-dir=/tmp/openweb-chrome

# 2. Browse to any site in that Chrome window

# 3. Start capture (runs in foreground, Ctrl+C to stop)
pnpm dev capture start --cdp-endpoint http://localhost:9222
# Or with custom output dir:
pnpm dev capture start --cdp-endpoint http://localhost:9222 --output ./my-capture

# 4. Stop from another terminal (alternative to Ctrl+C)
pnpm dev capture stop
```

### Verification

```bash
# Quick smoke test:
# 1. Start Chrome + navigate to jsonplaceholder.typicode.com
# 2. Start capture
# 3. Navigate to /posts, /users, /posts/1
# 4. Ctrl+C → check output:
ls capture/
# Expected: traffic.har  state_snapshots/  dom_extractions/  metadata.json

# Verify HAR captured API requests:
cat capture/metadata.json   # requestCount > 0, snapshotCount > 0

# Verify filtering (no analytics domains in HAR):
grep -c "google-analytics" capture/traffic.har  # should be 0
```

### Architecture

-> See: [doc/main/browser-capture.md](../main/browser-capture.md)

## Code Conventions

- Max 400 lines/file
- Immutability by default
- Explicit error handling, no silent failures
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
