# OpenWeb — Architecture Overview

> System overview, 3-layer model, execution modes, and component map.
> Last updated: 2026-03-16 (commit: `dd2b17e`)

## Mission

Let any agent access the web easily, fast, and cheap.

-> See: [doc/mission.md](../mission.md)

## Three-Layer Model

```
┌───────────────────────────────────────────────────────────────┐
│  L1: Structural Spec (OpenAPI 3.1 + AsyncAPI)                 │  ~40% of sites
│  Pure HTTP — no browser needed                                │
├───────────────────────────────────────────────────────────────┤
│  L2: Interaction Primitives (27-type DSL)                     │  ~50% of sites
│  Declarative auth/CSRF/signing/pagination/extraction config   │
├───────────────────────────────────────────────────────────────┤
│  L3: Code Adapters (arbitrary JS in browser)                  │  ~10% of sites
│  Escape hatch for sites that defy declarative modeling        │
└───────────────────────────────────────────────────────────────┘
```

**Design principle**: Structure is the default, code is the exception.

L1+L2 covers ~93% of sites (validated against 103 OpenTabs plugins).
Only ~7% need L3 code adapters.

L1+L2 classification validated against 103 OpenTabs plugins.

---

## Execution Flow

```
                    ┌──────────────┐
                    │  CLI / Agent │
                    └──────┬───────┘
                           │ openweb <site> exec <op> '{...}'
                           ▼
                    ┌──────────────┐
                    │   executor   │  Load spec → find operation → resolve mode
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ direct   │ │ session  │ │ browser  │
        │  _http   │ │  _http   │ │  _fetch  │
        │          │ │          │ │          │
        │ Pure HTTP│ │ HTTP +   │ │ page.    │
        │ client   │ │ browser  │ │ evaluate │
        │          │ │ cookies  │ │ (fetch)  │
        └──────────┘ └────┬─────┘ └────┬─────┘
                          │            │
                    ┌─────┴────────────┴─────┐
                    │   L2 Primitive Pipeline │
                    │                        │
                    │ 1. resolveAuth()       │
                    │ 2. resolveCsrf()       │  mutations only
                    │ 3. resolveSigning()    │  per-request
                    │                        │
                    │ → merged headers dict  │
                    └────────────────────────┘

        ┌──────────┐
        │   L3     │  adapter.init() → isAuthenticated() → execute()
        │ adapter  │  Full Playwright access, arbitrary JS
        └──────────┘
```

-> See: [runtime.md](runtime.md) — full execution pipeline details

---

## Key Components

| Component | What it does | Key files | Status |
|-----------|-------------|-----------|--------|
| **Meta-spec** | x-openweb schema: L2 types + L3 interface + package format | `src/types/` | Formalized (M1) |
| **Runtime** | Reads skill packages, resolves primitives, executes requests | `src/runtime/` | L1 + L2 + L3 complete (M4) |
| **Compiler** | Captures behavior, detects patterns, emits skill packages | `src/compiler/` | Phases 2-4 partial (L1 emit) |
| **Capture** | CDP browser recording (HAR + WS + state + DOM) | `src/capture/` | Complete (M0) |
| **CLI** | Progressive navigation + exec + capture + compile | `src/cli.ts`, `src/commands/` | Complete |
| **Skill packages** | Per-site instance specs | `src/fixtures/` | 9 verified sites |
| **Agent skill** | CLI wrapper for Claude/Codex | — | Not started (M5) |

---

## Execution Modes

| Mode | Transport | Browser needed | When to use |
|------|-----------|---------------|-------------|
| `direct_http` | Pure HTTP client | No | Public APIs, API-key auth |
| `session_http` | HTTP + cookies from browser | Yes (CDP) | Cookie auth, CSRF, token extraction |
| `browser_fetch` | `page.evaluate(fetch(...))` | Yes (CDP) | Signing, native TLS, CORS-bound APIs |

**Mode resolution**: operation-level `x-openweb.mode` → server-level `x-openweb.mode` → `direct_http`

-> See: [runtime.md](runtime.md) — mode dispatch details

---

## L2 Primitive Pipeline

Auth, CSRF, and signing are resolved as a pipeline on every L2 request:

```
┌────────────────────────────────────────────────────────┐
│  1. Auth         Cookies + auth headers                │
│     cookie_session, localStorage_jwt, page_global,     │
│     webpack_module_walk, exchange_chain, ...            │
│                                                        │
│  2. CSRF         Anti-forgery headers (mutations only) │
│     cookie_to_header, meta_tag, api_response, ...      │
│                                                        │
│  3. Signing      Per-request signatures                │
│     sapisidhash, gapi_proxy, aws_sigv4                 │
│                                                        │
│  → All results merged into one headers dict            │
└────────────────────────────────────────────────────────┘
```

-> See: [primitives.md](primitives.md) — all 27 primitive types

---

## CLI Interface

```bash
openweb sites                                  # list compiled sites
openweb <site>                                 # list operations (tools)
openweb <site> <op>                            # show params + response schema
openweb <site> exec <op> '{...}'               # execute operation
openweb <site> test                            # run site test cases
openweb capture start --cdp-endpoint ...       # record browser session
openweb compile <url>                          # generate skill package
```

---

## Verified Sites (M0-M4)

| Site | Layer | Auth | CSRF | Signing | Extraction | Mode |
|------|-------|------|------|---------|------------|------|
| Open-Meteo | L1 | — | — | — | — | direct_http |
| Instagram | L2 | cookie_session | cookie_to_header | — | — | session_http |
| Bluesky | L2 | localStorage_jwt | — | — | — | session_http |
| YouTube | L2 | page_global | — | sapisidhash | — | session_http |
| GitHub | L2 | cookie_session | meta_tag | — | script_json | session_http |
| Reddit | L2 | cookie_session | — | — | — | session_http |
| Discord | L2 | webpack_module_walk | — | — | — | browser_fetch |
| WhatsApp | L3 | adapter | — | — | adapter | browser_fetch |
| Telegram | L3 | adapter | — | — | adapter | browser_fetch |

---

## Related Docs

- [runtime.md](runtime.md) — Execution pipeline details
- [primitives.md](primitives.md) — L2 primitive resolvers
- [adapters.md](adapters.md) — L3 adapter framework
- [meta-spec.md](meta-spec.md) — Type system and validation
- [compiler.md](compiler.md) — Compiler pipeline
- [browser-capture.md](browser-capture.md) — CDP capture module
- [security.md](security.md) — SSRF protection and error model
- `src/fixtures/` — All verified site packages
