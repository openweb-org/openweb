# OpenWeb Documentation

> Entry point and navigation guide for the codebase.
> Last updated: 2026-03-23 (doc-normalize)

## Quick Start

| Task | Command |
|------|---------|
| Build | `pnpm build` |
| Test | `pnpm test` |
| Lint | `pnpm lint` |
| List sites | `pnpm dev sites` |
| Execute | `pnpm dev <site> exec <op> '{...}'` |

---

## Documentation Map

```
doc/main/
│
├── README.md              ← You are here (navigation guide)
│
├── architecture.md        # System overview, 3-layer model, execution modes
│
├── runtime.md             # Execution pipeline: mode dispatch, parameter binding, redirects
├── primitives/            # L2 primitive resolvers: auth, CSRF, signing, pagination, extraction
│   ├── README.md          #   Overview, taxonomy, resolution pipeline
│   ├── auth.md            #   Auth primitives (cookie_session, localStorage_jwt, etc.)
│   └── signing.md         #   CSRF and signing primitives
├── adapters.md            # L3 adapter framework: CodeAdapter interface, loading, lifecycle
│
├── meta-spec.md           # Type system: L2 types, x-openweb extensions, JSON Schema, validation
│
├── compiler.md            # Compiler pipeline: record → analyze → classify → emit
├── browser-capture.md     # CDP capture module: HAR + WS + state + DOM recording
│
└── security.md            # SSRF protection, redirect safety, error model
```

---

## Code Structure

```
src/
├── cli.ts                      # Entry point, yargs routing
├── commands/                   # CLI commands
│   ├── exec.ts                 #   execute operation
│   ├── show.ts                 #   show site/operation info
│   ├── compile.ts              #   compile site → skill package
│   ├── capture.ts              #   CDP browser capture
│   ├── test.ts                 #   run site tests
│   └── sites.ts                #   list available sites
│
├── runtime/                    # Operation execution
│   ├── executor.ts             #   Main dispatcher (mode routing)
│   ├── session-executor.ts     #   session_http mode (HTTP + browser cookies)
│   ├── browser-fetch-executor.ts # browser_fetch mode (page.evaluate)
│   ├── adapter-executor.ts     #   L3 adapter loading + execution
│   ├── extraction-executor.ts  #   extraction-only operations
│   ├── paginator.ts            #   Pagination (cursor + link_header)
│   ├── token-cache.ts          #   Auth token cache with TTL
│   ├── navigator.ts            #   CLI navigation helper
│   ├── value-path.ts           #   Shared dot-path helper
│   └── primitives/             #   L2 primitive resolvers (14 handlers + helpers)
│       ├── cookie-session.ts
│       ├── cookie-to-header.ts
│       ├── localstorage-jwt.ts
│       ├── page-global.ts
│       ├── sessionstorage-msal.ts
│       ├── sapisidhash.ts
│       ├── meta-tag.ts
│       ├── api-response.ts
│       ├── exchange-chain.ts
│       ├── script-json.ts
│       ├── ssr-next-data.ts
│       ├── html-selector.ts
│       ├── page-global-data.ts
│       └── webpack-module-walk.ts
│
├── types/                      # Meta-spec type system
│   ├── primitives.ts           #   27 L2 primitive discriminated unions
│   ├── primitive-schemas.ts    #   JSON Schema for L2 primitives (AJV)
│   ├── extensions.ts           #   XOpenWebServer, XOpenWebOperation
│   ├── adapter.ts              #   CodeAdapter interface
│   ├── manifest.ts             #   Manifest type
│   ├── schema.ts               #   Composite JSON Schema
│   ├── validator.ts            #   AJV validation
│   └── index.ts                #   Re-exports
│
├── compiler/                   # Site compilation
│   ├── recorder.ts             #   HAR parsing + scripted recording
│   ├── generator.ts            #   OpenAPI + manifest emission
│   └── analyzer/               #   cluster → filter → differentiate → schema → annotate → classify
│
├── capture/                    # Browser CDP recording
│   ├── session.ts              #   Capture lifecycle orchestrator
│   ├── har-capture.ts          #   HTTP traffic capture + filtering
│   ├── ws-capture.ts           #   WebSocket frame capture
│   ├── state-capture.ts        #   localStorage, sessionStorage, cookies
│   ├── dom-capture.ts          #   Meta tags, hidden inputs, framework globals
│   ├── bundle.ts               #   Write capture bundle to disk
│   ├── connection.ts           #   CDP connection with retry
│   └── types.ts                #   Capture type definitions
│
├── lib/                        # Shared utilities
│   ├── openapi.ts              #   OpenAPI parsing, URL building, site resolution
│   ├── ssrf.ts                 #   SSRF validation (IPv4/v6, DNS, metadata)
│   └── errors.ts               #   Structured error contract
│
└── sites/                      # Site packages (12 sites)
    ├── open-meteo/     #   L1 (no x-openweb)
    ├── instagram/      #   L2 (cookie_session + cookie_to_header)
    ├── bluesky/        #   L2 (localStorage_jwt)
    ├── youtube/        #   L2 (page_global + sapisidhash)
    ├── github/         #   L2 (meta_tag + script_json)
    ├── reddit/         #   L2 (cookie_session)
    ├── walmart/        #   L2 (ssr_next_data extraction)
    ├── hackernews/     #   L2 (html_selector extraction)
    ├── microsoft-word/ #   L2 (sessionStorage_msal auth)
    ├── discord/        #   L2 (webpack_module_walk + browser_fetch)
    ├── whatsapp/       #   L3 adapter (Meta require() module system)
    └── telegram/       #   L3 adapter (teact global state)
```

---

## Reading Order

### New to the codebase?

1. [architecture.md](architecture.md) — 3-layer model, execution modes, system overview
2. [runtime.md](runtime.md) — How operations execute end-to-end
3. [meta-spec.md](meta-spec.md) — The type system that drives everything
4. [primitives/](primitives/README.md) — How auth/CSRF/signing are resolved

### Working on specific areas?

| Area | Start With |
|------|------------|
| Adding a new site | [primitives/](primitives/README.md), [dev/adding-sites.md](../dev/adding-sites.md) |
| Runtime execution | [runtime.md](runtime.md), [security.md](security.md) |
| L2 auth/CSRF/signing | [primitives/](primitives/README.md) |
| L3 adapters | [adapters.md](adapters.md) |
| Type system & validation | [meta-spec.md](meta-spec.md) |
| Compiler pipeline | [compiler.md](compiler.md), [browser-capture.md](browser-capture.md) |
| Browser capture | [browser-capture.md](browser-capture.md) |
| Security model | [security.md](security.md) |
| Dev workflow | [dev/development.md](../dev/development.md) |

---

## Key Concepts

| Concept | Description | Doc |
|---------|-------------|-----|
| **3-Layer Model** | L1 structural spec, L2 interaction primitives, L3 code adapters | [architecture.md](architecture.md) |
| **x-openweb** | OpenAPI extension carrying auth/CSRF/signing/pagination config | [meta-spec.md](meta-spec.md) |
| **Execution Mode** | `direct_http`, `session_http`, `browser_fetch` — how requests reach the server | [runtime.md](runtime.md) |
| **Primitive** | Declarative config unit for auth, CSRF, signing, pagination, extraction | [primitives/](primitives/README.md) |
| **CodeAdapter** | L3 escape hatch — arbitrary JS running in browser context | [adapters.md](adapters.md) |
| **Skill Package** | Per-site artifact: openapi.yaml + manifest.json + adapters/ + tests/ | [compiler.md](compiler.md) |
| **Capture Bundle** | Raw recording: traffic.har + websocket_frames.jsonl + state + DOM | [browser-capture.md](browser-capture.md) |
| **SSRF Protection** | DNS-resolved IP validation on every outgoing request | [security.md](security.md) |

---

## Development Workflow

-> See: [doc/dev/development.md](../dev/development.md)
