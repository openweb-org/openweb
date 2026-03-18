# OpenWeb — Architecture Overview

> System overview, 3-layer model, transport model, and component map.
> Last updated: 2026-03-18 (commit: M19)

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
                    │   executor   │  Load spec → find operation → permission gate → resolve transport
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
| **Runtime** | Reads skill packages, resolves primitives, executes requests | `src/runtime/` | L1 + L2 + L3 + extraction + token cache (M14) |
| **Compiler** | Captures behavior, detects patterns, emits skill packages | `src/compiler/` | L1 emit + L2 classify + probe (M15) |
| **Capture** | CDP browser recording (HAR + WS + state + DOM), dynamic globals detection | `src/capture/` | Complete (M0), page isolation (M11), dynamic globals (M17) |
| **Lifecycle** | Drift detection, verification, quarantine | `src/lifecycle/` | Fingerprint + verify + quarantine (M12) |
| **Knowledge** | Agent reference docs for archetypes and site-specific notes | `.claude/skills/openweb/references/` | Reference docs (M19), CLI + CompileSummary removed (M20) |
| **Registry** | Site version management, install, rollback | `src/lifecycle/registry.ts` | Internal registry (M12) |
| **CLI** | Progressive navigation + exec + browser + capture + compile + verify + registry | `src/cli.ts`, `src/commands/` | Complete (M14: browser, login; M18: discovery moved to agent workflow; M20: knowledge CLI removed) |
| **Skill packages** | Per-site instance specs | `src/fixtures/` | 51 verified sites |
| **Agent skill** | CLI wrapper for Claude/Codex agents | `.claude/skills/openweb/SKILL.md` | Complete (M5), Draft-Curate-Verify + knowledge refs (M19) |

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
openweb sites [--json]                         # list compiled sites
openweb <site> [--json]                        # list operations (tools)
openweb <site> <op> [--json] [--example]       # show params + response schema
openweb <site> exec <op> '{...}'               # execute operation (auto-detects managed browser)
openweb <site> exec <op> '{...}' --output file # always write response to file
openweb <site> test                            # run site test cases
openweb browser start [--headless]             # managed Chrome lifecycle
openweb browser stop / restart / status
openweb login <site>                           # open site in default browser for auth
openweb capture start --cdp-endpoint ...       # record browser session
openweb compile <url> [--probe]                  # generate skill package (--probe validates heuristics)
openweb verify <site>                          # verify site and detect drift
openweb verify --all                           # batch verify all sites
openweb verify --all --report                  # verify with drift report
openweb registry list                          # list registered site versions
openweb registry install <site>                # archive fixture to registry
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

When `x-openweb.permission` is absent, the runtime derives permission from HTTP method (fail-closed).
Policy is configurable per-site in `~/.openweb/permissions.yaml`.
`prompt` policy returns a structured error for the agent to relay to the user.

-> See: `src/lib/permissions.ts`, `src/runtime/executor.ts`

---

## Browser Lifecycle (M14)

`openweb browser start` copies auth-relevant files from the default Chrome profile to a secure temp directory (`mkdtemp`, mode 0o700), launches Chrome with CDP, and saves PID/port to `~/.openweb/`. All `exec` commands auto-detect the managed browser — no `--cdp-endpoint` needed.

Token cache at `~/.openweb/tokens/<site>/` stores cookies + localStorage + sessionStorage after successful authenticated requests. Cache has JWT-aware TTL. Cache hit → no browser connection needed. 401/403 → cache invalidated → browser fallback.

-> See: `src/commands/browser.ts`, `src/runtime/token-cache.ts`

---

## Verified Sites (M0-M12)

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
| ChatGPT | L2 | exchange_chain | — | — | — | node |
| X | L2 | cookie_session | cookie_to_header | — | — | page |
| WhatsApp | L3 | adapter | — | — | adapter | adapter (L3) |
| Telegram | L3 | adapter | — | — | adapter | adapter (L3) |
| Stack Overflow | L1 | — | — | — | — | node |
| CoinGecko | L1 | — | — | — | — | node |
| Wikipedia | L1 | — | — | — | — | node |
| npm | L1 | — | — | — | — | node |
| DuckDuckGo | L1 | — | — | — | — | node |
| JSONPlaceholder | L1 | — | — | — | — | node |
| Dog CEO | L1 | — | — | — | — | node |
| GitHub (public) | L1 | — | — | — | — | node |
| REST Countries | L1 | — | — | — | — | node |
| IP API | L1 | — | — | — | — | node |
| Agify | L1 | — | — | — | — | node |
| Bored API | L1 | — | — | — | — | node |
| Cat Facts | L1 | — | — | — | — | node |
| Exchange Rate | L1 | — | — | — | — | node |
| Genderize | L1 | — | — | — | — | node |
| HTTPBin | L1 | — | — | — | — | node |
| Nationalize | L1 | — | — | — | — | node |
| Open Library | L1 | — | — | — | — | node |
| PokeAPI | L1 | — | — | — | — | node |
| Random User | L1 | — | — | — | — | node |
| Advice Slip | L1 | — | — | — | — | node |
| Affirmations | L1 | — | — | — | — | node |
| Chuck Norris | L1 | — | — | — | — | node |
| CocktailDB | L1 | — | — | — | — | node |
| Color API | L1 | — | — | — | — | node |
| Country.is | L1 | — | — | — | — | node |
| Dictionary API | L1 | — | — | — | — | node |
| Random Fox | L1 | — | — | — | — | node |
| Kanye Rest | L1 | — | — | — | — | node |
| Official Joke | L1 | — | — | — | — | node |
| Public Holidays | L1 | — | — | — | — | node |
| Sunrise Sunset | L1 | — | — | — | — | node |
| Universities | L1 | — | — | — | — | node |
| Useless Facts | L1 | — | — | — | — | node |
| World Time | L1 | — | — | — | — | node |
| Zippopotam | L1 | — | — | — | — | node |

**Note:** The GitHub public fixture also includes a `graphqlQuery` operation (POST `/graphql`, `permission: write`) demonstrating POST-based GraphQL on a public API.

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
