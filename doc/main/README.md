# OpenWeb Documentation

> Entry point and navigation guide for the codebase.
> Last updated: 2026-04-01 (batch0/1/2 rediscovery, pipeline gap fixes)

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
├── compiler.md            # Compiler pipeline: capture → analyze → curate → generate → verify
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
├── runtime/                    # Operation execution (HTTP + WS)
│   ├── executor.ts             #   Main dispatcher (mode routing)
│   ├── http-executor.ts        #   HTTP execution (direct + session)
│   ├── browser-fetch-executor.ts # browser_fetch mode (page.evaluate)
│   ├── node-ssr-executor.ts    #   Node SSR execution
│   ├── ws-executor.ts          #   WebSocket operation execution
│   ├── ws-connection.ts        #   WS connection manager (7-state machine)
│   ├── ws-router.ts            #   WS message routing
│   ├── ws-runtime.ts           #   WS runtime lifecycle
│   ├── cache-manager.ts        #   Response cache
│   ├── token-cache.ts          #   Auth token cache (AES-256-GCM vault)
│   ├── navigator.ts            #   CLI navigation helper (render site/operation info)
│   └── primitives/             #   L2 primitive resolvers (14 handlers)
│
├── types/                      # Meta-spec type system
│   ├── primitives.ts           #   L2 primitive discriminated unions
│   ├── primitive-schemas.ts    #   JSON Schema for L2 primitives (AJV)
│   ├── extensions.ts           #   XOpenWebServer, XOpenWebOperation
│   ├── adapter.ts              #   CodeAdapter interface
│   └── index.ts                #   Re-exports
│
├── compiler/                   # Site compilation (pipeline v2)
│   ├── types.ts                #   Core types (RecordedRequestSample, SampleResponse)
│   ├── types-v2.ts             #   Pipeline v2 contracts (all 5-phase types)
│   ├── recorder.ts             #   HAR parsing + scripted recording
│   ├── analyzer/               #   Phase 2: label → normalize → cluster → schema → auth
│   │   ├── analyze.ts          #     Orchestrator: analyzeCapture() → AnalysisReport
│   │   ├── labeler.ts          #     Sample categorization (api/static/tracking/off_domain)
│   │   ├── path-normalize.ts   #     Path template normalization
│   │   ├── graphql-cluster.ts  #     GraphQL sub-clustering
│   │   ├── auth-candidates.ts  #     Ranked auth bundling with evidence + CSRF options
│   │   ├── constant-headers.ts #     Detect constant headers across cluster samples
│   │   ├── schema-v2.ts        #     Schema inference with enum/format controls
│   │   ├── example-select.ts   #     Tiered example value selection with PII scrub
│   │   └── classify.ts         #     Extraction signal detection (SSR, script_json, page_global)
│   ├── curation/               #   Phase 3: apply-curation.ts, scrub.ts (PII)
│   ├── generator/              #   Phase 4: generate-v2.ts (OpenAPI + AsyncAPI emission)
│   └── ws-analyzer/            #   WS capture → classify → cluster → schema
│
├── capture/                    # Browser CDP recording
│   ├── session.ts              #   Capture lifecycle orchestrator
│   ├── har-capture.ts          #   HTTP traffic capture (body-size-gate, no content filtering)
│   ├── ws-capture.ts           #   WebSocket frame capture
│   ├── state-capture.ts        #   localStorage, sessionStorage, cookies
│   ├── dom-capture.ts          #   Meta tags, hidden inputs, framework globals
│   ├── bundle.ts               #   Write capture bundle to disk
│   └── connection.ts           #   CDP connection with retry
│
├── lifecycle/                   # Site lifecycle management
│   ├── verify.ts               #   Verify command (execute examples, check drift)
│   ├── fingerprint.ts          #   Response fingerprinting for drift detection
│   └── registry.ts             #   Site registry (archive, install, rollback)
│
├── lib/                        # Shared utilities
│   ├── site-resolver.ts        #   Site resolution (bundled + user-installed)
│   ├── spec-loader.ts          #   OpenAPI/AsyncAPI spec loading
│   ├── site-package.ts         #   Site package abstraction
│   ├── openapi.ts              #   OpenAPI parsing, URL building
│   ├── asyncapi.ts             #   AsyncAPI parsing
│   ├── param-validator.ts      #   Parameter validation
│   ├── permissions.ts          #   Permission system
│   ├── permission-derive.ts    #   Permission derivation from specs
│   ├── ssrf.ts                 #   SSRF validation (mandatory)
│   ├── errors.ts               #   OpenWebError structured errors
│   ├── logger.ts               #   Logger utility
│   ├── config.ts               #   Configuration
│   ├── cookies.ts              #   Cookie management
│   └── config/                 #   Config files: blocked-domains, blocked-paths, tracking-cookies, static-extensions
│
└── sites/                      # Site packages (55 sites)
    ├── github/                 #   L1 (no x-openweb)
    ├── instagram/              #   L2 (cookie_session + cookie_to_header)
    ├── youtube/                #   L2 (page_global + sapisidhash)
    ├── discord/                #   L2 (webpack_module_walk, page transport)
    ├── whatsapp/               #   L3 adapter (Meta require() module system)
    ├── telegram/               #   L3 adapter (teact global state)
    └── ...                     #   50 more sites
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
| **Skill Package** | Per-site artifact: openapi.yaml + manifest.json + adapters/ + examples/ | [compiler.md](compiler.md) |
| **AsyncAPI Package** | Per-site WS artifact: asyncapi.yaml for real-time event channels | [compiler.md](compiler.md) |
| **Capture Bundle** | Raw recording: traffic.har + websocket_frames.jsonl + state + DOM | [browser-capture.md](browser-capture.md) |
| **SSRF Protection** | DNS-resolved IP validation on every outgoing request | [security.md](security.md) |

---

## Skill Documentation

`skill/openweb/` is the **user-facing operator guide** — it tells agents how to use OpenWeb, add sites, and troubleshoot. `doc/main/` is the **developer-facing architecture docs** — it explains how the system works internally.

Both are **self-contained** and derive from source code as the single source of truth. Neither references the other's files directly. They stay aligned indirectly: both accurate with code means both consistent with each other.

**Sync rule:** when updating `doc/main/` in a way that changes operator-facing behavior (e.g., new auth primitive, changed transport semantics, new CLI flag), check whether `skill/openweb/` needs a corresponding update.

-> See: [skill/openweb/SKILL.md](../../skill/openweb/SKILL.md) for the skill entry point.

---

## Development Workflow

-> See: [doc/dev/development.md](../dev/development.md)
