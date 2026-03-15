# OpenWeb v2: Website-to-API Compiler — Three-Layer Architecture

> **Status**: DRAFT — Iterating via ralph-loop
> **Supersedes**: v1 (archived in `archive/v1/`)
> **Date**: 2026-03-15

## What Changed from v1

v1 designed a HAR-based compiler with a custom navigation agent and three execution
modes (direct_http, session_http, browser_fetch). Two major insights led to v2:

1. **12 design gaps** found by analyzing 100+ OpenTabs plugins (see `docs/todo/design_gap/`).
   HAR-only capture is fundamentally insufficient for modern SPAs.
2. **The user's agent IS the browser-use agent.** No separate navigation agent needed.
   Claude Code (or any agent) connects to the browser via Playwright CLI, browses
   naturally, and openweb captures/compiles alongside. One CDP connection, zero conflict.

**v2 changes:**
- Three-layer architecture (L1 structural + L2 primitives + L3 code escape hatch)
- No built-in navigation agent — delegate browsing to Playwright CLI
- Multi-source capture (not just HAR): HTTP, WebSocket, browser state, DOM
- AsyncAPI 3.x for WebSocket/SSE protocol description
- Two-layer Playwright: agent uses CLI, OpenWeb compiler uses SDK (same CDP)

## Design Principle

**Structure is the default, code is the exception.**

## Three-Layer Architecture

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Structural Spec (declarative)          │
│  Standard OpenAPI 3.1 endpoints                  │
│  Covers: ~40% of sites (simple REST/GraphQL)     │
├─────────────────────────────────────────────────┤
│  Layer 2: Interaction Primitives (pattern DSL)    │
│  Parameterized patterns for auth, CSRF, signing  │
│  Covers: ~50% of sites (auth + CSRF + pagination)│
├─────────────────────────────────────────────────┤
│  Layer 3: Code Adapters (escape hatch)           │
│  Arbitrary JS in browser page context            │
│  Covers: ~10% of sites (WhatsApp, Telegram, etc) │
└─────────────────────────────────────────────────┘
```

## Key Architectural Decisions (v2)

### D1: Agent IS the browser-use agent
No separate navigation agent. The user's agent (Claude Code, etc.) drives the browser
via Playwright CLI (`.reference/browser-infra/playwright-cli`). OpenWeb doesn't compete
with Playwright's scope — it adds compilation and tool execution on top.

### D2: Multi-source capture (not just HAR)
| Data | Source | Playwright CLI command |
|---|---|---|
| HTTP requests/responses | HAR or `network` | `playwright-cli network` |
| WebSocket frames | CDP events | `playwright-cli run-code` (CDP intercept) |
| localStorage | Browser storage | `playwright-cli localstorage-list` |
| sessionStorage | Browser storage | `playwright-cli sessionstorage-list` |
| cookies | Browser cookies | `playwright-cli cookie-list` |
| window globals | JS evaluation | `playwright-cli eval` |

### D3: Non-HTTP protocol spec — AsyncAPI 3.x
WebSocket/SSE described via AsyncAPI 3.x (complements OpenAPI 3.1, shared JSON Schema).
Capture format: JSONL for frame-level recording. See [browser-integration.md](browser-integration.md).

## Document Map

| Document | Status | Description |
|---|---|---|
| [openweb-design.md](openweb-design.md) | TODO | Main design doc (evolved from v1) |
| [browser-integration.md](browser-integration.md) | TODO | **NEW**: Playwright CLI integration & capture architecture |
| [layer2-interaction-primitives.md](layer2-interaction-primitives.md) | TODO | **NEW**: Pattern DSL for auth/CSRF/signing/pagination |
| [layer3-code-adapters.md](layer3-code-adapters.md) | TODO | **NEW**: Code escape hatch spec |
| [pattern-library.md](pattern-library.md) | TODO | **NEW**: Catalog of all known patterns |
| [compiler-pipeline.md](compiler-pipeline.md) | TODO | Pipeline (evolved from v1, adds multi-source capture + pattern matching) |
| [runtime-executor.md](runtime-executor.md) | TODO | Runtime (evolved from v1, adds L2/L3 execution) |
| [skill-package-format.md](skill-package-format.md) | TODO | Package format (evolved from v1, adds L2/L3 artifacts) |
| [gap-coverage-matrix.md](gap-coverage-matrix.md) | TODO | **NEW**: How each gap maps to a layer/primitive |
| [security-taxonomy.md](security-taxonomy.md) | TODO | Probing protocol (mostly unchanged from v1) |
| [self-evolution.md](self-evolution.md) | TODO | Knowledge base (mostly unchanged from v1) |

## Reference Materials

- `doc/final/archive/v1/` — Previous design (still valid for L1 + runtime + CLI)
- `docs/todo/design_gap/001-012_*.md` — 12 design gaps from OpenTabs analysis
- `docs/todo/design_gap/discussion/001-003_*.md` — Architectural comparison & philosophy
- `.reference/reverse-api/opentabs/` — OpenTabs source (100+ plugins)
- `.reference/reverse-api/apitap/` — ApiTap source
- `.reference/browser-infra/playwright-cli/` — Playwright CLI (browser control layer)

## Coverage Target

Must address all 12 design gaps identified from OpenTabs plugin analysis:

| # | Gap | Target Layer | Primitive(s) | Status |
|---|---|---|---|---|
| 001 | Pure SSR / no client API | L2 | `extraction.ssr_*`, `extraction.html_dom` | TODO |
| 002 | Browser state extraction | L2 | `auth.localStorage_jwt`, `auth.sessionStorage_msal`, `auth.page_global` | TODO |
| 003 | WebSocket protocols | L2/L3 | `auth.websocket_intercept` or L3 adapter | TODO |
| 004 | Dynamic request signing | L2 | `signing.sapisidhash`, `signing.aws_sigv4`; L3 for obfuscated | TODO |
| 005 | CSRF token rotation | L2 | `csrf.cookie_to_header`, `csrf.meta_tag`, `csrf.page_global` | TODO |
| 006 | DOM parsing / SSR cache | L2 | `extraction.ssr_next_data`, `extraction.apollo_cache` | TODO |
| 007 | No HTTP API | L3 | Code adapter (WhatsApp, Telegram) | TODO |
| 008 | Multi-step auth exchange | L2 | `auth.oauth_refresh`, `auth.token_exchange` | TODO |
| 009 | Persisted query hashes | L2/L3 | `graphql.persisted_query_discovery` | TODO |
| 010 | Google gapi proxy | L2 | `auth.gapi_proxy` | TODO |
| 011 | Page navigation / DOM | L3 | Code adapter (navigate, BroadcastChannel) | TODO |
| 012 | Cross-origin bearer | L2 | `auth.cross_origin_bearer`, multi-domain config | TODO |
