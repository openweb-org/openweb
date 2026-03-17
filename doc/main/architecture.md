# OpenWeb — Architecture Overview

> System overview, 3-layer model, transport model, and component map.
> Last updated: 2026-03-17 (commit: M9)

## Mission

Let any agent access the web easily, fast, and cheap.

-> See: [doc/mission.md](../mission.md)

## Three-Layer Model

```
┌───────────────────────────────────────────────────────────────┐
│  L1: Structural Spec (OpenAPI 3.1 + AsyncAPI)                 │  ~40% of sites
│  Pure HTTP — no browser needed                                │
├───────────────────────────────────────────────────────────────┤
│  L2: Interaction Primitives (17-type DSL)                     │  ~50% of sites
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
                    │ Agent Skill  │  .claude/skills/openweb/SKILL.md
                    └──────┬───────┘
                           │ natural language → CLI command
                    ┌──────────────┐
                    │  CLI / Agent │
                    └──────┬───────┘
                           │ openweb <site> exec <op> '{...}'
                           ▼
                    ┌──────────────┐
                    │   executor   │  Load spec → find operation → resolve transport
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ adapter  │ │extraction│ │   page   │
        │  (L3)    │ │          │ │          │
        │          │ │ DOM/JSON │ │ page.    │
        │ arbitrary│ │ from live│ │ evaluate │
        │ JS       │ │ page     │ │ (fetch)  │
        └──────────┘ └──────────┘ └────┬─────┘
                                       │
                                 ┌─────┴─────┐
                                 │   node    │
                                 │           │
                                 │ HTTP from │
                                 │ Node.js   │
                                 │ ± auth    │
                                 └───────────┘

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
| **Runtime** | Reads skill packages, resolves primitives, executes requests | `src/runtime/` | L1 + L2 + L3 + extraction complete (M6) |
| **Compiler** | Captures behavior, detects patterns, emits skill packages | `src/compiler/` | Phases 2-4 partial (L1 emit) |
| **Capture** | CDP browser recording (HAR + WS + state + DOM) | `src/capture/` | Complete (M0) |
| **CLI** | Progressive navigation + exec + capture + compile | `src/cli.ts`, `src/commands/` | Complete |
| **Skill packages** | Per-site instance specs | `src/fixtures/` | 15 verified sites |
| **Agent skill** | CLI wrapper for Claude/Codex agents | `.claude/skills/openweb/SKILL.md` | Complete (M5) |

---

## Transport Model

| Transport | Mechanism | Browser needed | When to use |
|-----------|-----------|---------------|-------------|
| `node` | HTTP from Node.js. If auth/csrf/signing config present, uses browser cookies. | Only for auth | Public APIs, cookie auth, CSRF, token extraction |
| `page` | HTTP via `page.evaluate(fetch(...))`. Always needs browser. | Yes (CDP) | Signing, native TLS, CORS-bound APIs |

**Transport resolution**: operation-level `x-openweb.transport` → server-level `x-openweb.transport` → default `node`
`x-openweb.extraction` short-circuits HTTP transport dispatch and runs directly against the matching page state.

-> See: [runtime.md](runtime.md) — transport dispatch details

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
│     sapisidhash                                        │
│                                                        │
│  → All results merged into one headers dict            │
└────────────────────────────────────────────────────────┘
```

-> See: [primitives.md](primitives.md) — all 17 primitive types

---

## CLI Interface

```bash
openweb sites                                  # list compiled sites
openweb <site>                                 # list operations (tools)
openweb <site> <op>                            # show params + response schema
openweb <site> exec <op> '{...}'               # execute operation
openweb <site> exec <op> '{...}' --max-response 8192  # emit a valid JSON preview when stdout would be too large
openweb <site> test                            # run site test cases
openweb capture start --cdp-endpoint ...       # record browser session
openweb compile <url>                          # generate skill package
```

---

## Verified Sites (M0-M6 Tranche B)

| Site | Layer | Auth | CSRF | Signing | Extraction | Transport |
|------|-------|------|------|---------|------------|-----------|
| Open-Meteo | L1 | — | — | — | — | node |
| Instagram | L2 | cookie_session | cookie_to_header | — | — | node |
| Bluesky | L2 | localStorage_jwt | — | — | — | node |
| YouTube | L2 | page_global | — | sapisidhash | — | node |
| GitHub | L2 | cookie_session | meta_tag | — | script_json | node |
| Reddit | L2 | cookie_session | — | — | — | node |
| Walmart | L2 | — | — | — | ssr_next_data | node |
| Hacker News | L2 | — | — | — | html_selector | node |
| Microsoft Word | L2 | sessionStorage_msal | — | — | — | node |
| New Relic | L2 | cookie_session | — | — | — | node |
| Discord | L2 | webpack_module_walk | — | — | — | page |
| WhatsApp | L3 | adapter | — | — | adapter | adapter (L3) |
| Telegram | L3 | adapter | — | — | adapter | adapter (L3) |

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
