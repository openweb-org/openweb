# OpenWeb — Architecture Overview

> System overview, 3-layer model, transport model, and component map.
> Last updated: 2026-03-29 (v1+v5 site merge)

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

L1+L2 covers ~90% of sites (M22 sweep: 121/144 reachable with current primitives + L2 login).
Only ~5.6% need L3 code adapters, ~9% need new primitives.

M22 coverage sweep validated against 144 sites across 15 archetypes.

---

## Execution Flow

```
                    ┌──────────────┐
                    │ Agent Skill  │  skill/openweb/SKILL.md
                    └──────┬───────┘
                           │ natural language → CLI command
                    ┌──────────────┐
                    │  CLI / Agent │
                    └──────┬───────┘
                           │ openweb <site> <op> '{...}'
                           ▼
                    ┌──────────────┐
                    │   executor   │  Load spec → find operation → permission gate → resolve transport
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┼────────────┐
              │            │            │            │
              ▼            ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ adapter  │ │extraction│ │   page   │ │    ws    │
        │  (L3)    │ │          │ │          │ │          │
        │          │ │ DOM/JSON │ │ page.    │ │ WebSocket│
        │ arbitrary│ │ from live│ │ evaluate │ │ real-time│
        │ JS       │ │ page     │ │ (fetch)  │ │ channels │
        └──────────┘ └──────────┘ └────┬─────┘ └──────────┘
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
| **Runtime** | Reads skill packages, resolves primitives, executes requests (HTTP + WS) | `src/runtime/` | L1 + L2 + L3 + extraction + WS + token cache (M35) |
| **Compiler** | Captures behavior, analyzes patterns, curates plan, emits skill packages (OpenAPI + AsyncAPI), verifies | `src/compiler/` | Pipeline v2: 5-phase (capture → analyze → curate → generate → verify) |
| **Capture** | CDP browser recording (HAR + WS + state + DOM), no content filtering, body-size-gate only | `src/capture/` | Complete (M0), page isolation (M11), dynamic globals (M17), unfiltered (v2) |
| **Knowledge** | Agent reference docs for archetypes and site-specific notes | `skill/openweb/references/` | 2 process docs + 2 deep refs + 7 knowledge files |
| **CLI** | Progressive navigation + exec + browser + capture + compile + verify + registry | `src/cli.ts`, `src/commands/` | Complete — npm binary `openweb` (M33) |
| **Skill packages** | Per-site instance specs (OpenAPI + AsyncAPI) | `src/sites/` (dev), `$OPENWEB_HOME/sites/` (installed) | 56 sites with DOC.md + PROGRESS.md |
| **Agent skill** | CLI wrapper for Claude/Codex agents | `skill/openweb/SKILL.md` | 5-intent router (M38) |

---

## Transport Model

| Transport | Mechanism | Browser needed | When to use |
|-----------|-----------|---------------|-------------|
| `node` | HTTP from Node.js. If auth/csrf/signing config present, uses browser cookies. | Only for auth | Public APIs, cookie auth, CSRF, token extraction |
| `page` | HTTP via `page.evaluate(fetch(...))`. Always needs browser. | Yes (CDP) | Signing, native TLS, CORS-bound APIs |
| `ws` | WebSocket connection with message routing. AsyncAPI-defined channels. | Only for auth | Real-time APIs (Discord gateway, Coinbase feed) |

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

-> See: [primitives/](primitives/README.md) — all 17 primitive types

---

## CLI Interface

```bash
openweb init                                   # seed default sites to $OPENWEB_HOME/sites/
openweb sites [--json]                         # list compiled sites
openweb <site> [--json]                        # list operations (tools)
openweb <site> <op> [--json] [--example]       # show params + response schema
openweb <site> <op> '{...}'                    # execute operation (auto-exec on JSON arg)
openweb <site> exec <op> '{...}'               # execute (explicit exec keyword, still supported)
openweb <site> <op> '{...}' --output file      # always write response to file
openweb <site> test                            # run site test cases
openweb browser start [--headless]             # managed Chrome lifecycle
openweb browser stop / restart / status
openweb login <site>                           # open site in default browser for auth
openweb capture start --cdp-endpoint ...       # record browser session (--isolate for multi-worker)
openweb compile <url>                              # generate skill package
openweb verify <site>                          # verify site and detect drift
openweb verify --all                           # batch verify all sites
openweb verify --all --report                  # verify with drift report
openweb registry list                          # list registered site versions
openweb registry install <site>                # archive site to registry
openweb registry rollback <site>               # revert to previous version
```

---

## Permission System (M14)

Operations carry a `permission` category that gates execution:

| Category | HTTP Methods | Default Policy |
|----------|-------------|----------------|
| `read` | GET, HEAD | `allow` |
| `write` | POST, PUT, PATCH | `prompt` |
| `delete` | DELETE | `prompt` |
| `transact` | checkout/purchase/payment paths | `deny` |

When `x-openweb.permission` is absent, the runtime derives permission from HTTP method + API path (fail-closed). Paths matching `/checkout|purchase|payment|order|subscribe/` are auto-escalated to `transact`.
Policy is configurable per-site in `$OPENWEB_HOME/permissions.yaml` (defaults to `~/.openweb/permissions.yaml`).
`prompt` policy returns a structured error for the agent to relay to the user.

-> See: `src/lib/permissions.ts`, `src/runtime/executor.ts`

---

## Browser Lifecycle (M14)

`openweb browser start` copies auth-relevant files from the default Chrome profile to a secure temp directory (`mkdtemp`, mode 0o700), launches Chrome with CDP, and saves PID/port to `$OPENWEB_HOME/`. All `exec` commands auto-detect the managed browser — no `--cdp-endpoint` needed.

Token cache at `$OPENWEB_HOME/vault.json` stores cookies + localStorage + sessionStorage with AES-256-GCM encryption and PBKDF2 machine-binding. JWT-aware TTL. Cache hit → no browser connection needed. 401/403 → cache invalidated → browser fallback.

-> See: `src/commands/browser.ts`, `src/runtime/token-cache.ts`

---

## Verified Sites (representative)

| Site | Layer | Auth | CSRF | Signing | Extraction | Transport |
|------|-------|------|------|---------|------------|-----------|
| Open-Meteo | L1 | — | — | — | — | node |
| Instagram | L2 | cookie_session | cookie_to_header | — | — | page |
| Bluesky | L2 | localStorage_jwt | — | — | — | node |
| YouTube | L2 | page_global | — | sapisidhash | — | node |
| GitHub | L2 | cookie_session | meta_tag | — | script_json | node |
| Reddit | L1 | — | — | — | — | node |
| Walmart | L2 | — | — | — | ssr_next_data | node |
| Hacker News | L2 | — | — | — | html_selector | node |
| Microsoft Word | L2 | sessionStorage_msal | — | — | — | node |
| Discord | L2 | webpack_module_walk | — | — | — | page |
| ChatGPT | L2 | exchange_chain | — | — | — | node |
| Coinbase | WS | — | — | — | — | ws |
| LinkedIn | L2 | cookie_session | cookie_to_header | — | — | node |
| WhatsApp | L3 | adapter | — | — | adapter | adapter (L3) |
| Telegram | L3 | adapter | — | — | adapter | adapter (L3) |

68 total sites. Full list: `pnpm dev sites`

**Note:** The GitHub public fixture also includes a `graphqlQuery` operation (POST `/graphql`, `permission: write`) demonstrating POST-based GraphQL on a public API.

---

## Related Docs

- [runtime.md](runtime.md) — Execution pipeline details
- [primitives/](primitives/README.md) — L2 primitive resolvers
- [adapters.md](adapters.md) — L3 adapter framework
- [meta-spec.md](meta-spec.md) — Type system and validation
- [compiler.md](compiler.md) — Compiler pipeline
- [browser-capture.md](browser-capture.md) — CDP capture module
- [security.md](security.md) — SSRF protection and error model
- `src/sites/` — All verified site packages
