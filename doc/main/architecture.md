# OpenWeb — Architecture Overview

> **Last updated**: 2026-03-15 (commit `996682d`)

## Mission

Let any agent access the web easily, fast, and cheap.
-> See: [doc/mission.md](../mission.md)

## Three-Layer Architecture (v2)

```
┌───────────────────────────────────────────────┐
│  L1: Structural Spec (OpenAPI 3.1 + AsyncAPI) │  ~40% of sites
├───────────────────────────────────────────────┤
│  L2: Interaction Primitives (27-type DSL)     │  ~50% of sites
├───────────────────────────────────────────────┤
│  L3: Code Adapters (arbitrary JS in browser)  │  ~10% of sites
└───────────────────────────────────────────────┘
```

**Design principle**: Structure is the default, code is the exception.

L1+L2 covers 93% of sites (validated against 103 OpenTabs plugins).
Only 7 sites need L3 code adapters.

-> See: [doc/todo/v2/README.md](../todo/v2/README.md) — full architecture

## Key Components

| Component | What it does | Status |
|---|---|---|
| **Meta-spec** | x-openweb schema (L2 types + L3 interface + package format) | Designed, not yet formalized as types |
| **Runtime** | Reads skill packages, executes L2/L3 primitives, makes requests | L1 `direct_http` implemented |
| **Compiler** | Captures website behavior, detects patterns, emits skill packages | M0 capture done; phases 2-4 partial (L1 only) |
| **Capture** | CDP-based browser recording (HAR + WS + state + DOM) | **Implemented** (M0) |
| **Skill packages** | Per-site instance specs (openapi.yaml + x-openweb + adapters) | 1 fixture (Open-Meteo) |
| **Agent skill** | CLI wrapper for Claude/Codex | Not started |

-> See: [doc/main/browser-capture.md](browser-capture.md) — capture module details

-> See: [doc/note.md](../note.md) — artifacts + roadmap

## Execution Modes

| Mode | Transport | When |
|---|---|---|
| `direct_http` | Pure HTTP client | Public APIs, API-key auth |
| `session_http` | HTTP + cookies from browser | Cookie auth, CSRF, token extraction |
| `browser_fetch` | `page.evaluate(fetch(...))` | Signing, gapi, L3 adapters |

## CLI Interface

```bash
openweb sites                              # list compiled sites
openweb <site>                             # list operations
openweb <site> <op>                        # show params + response
openweb <site> exec <op> '{...}'           # execute
openweb capture start --cdp-endpoint ...   # record browser session
openweb compile <site>                     # generate skill package
```

## Design Documents

All v2 design docs (COMPLETE): [doc/todo/v2/](../todo/v2/)

| Doc | Describes |
|---|---|
| layer2-interaction-primitives.md | 27 L2 primitive types (auth/csrf/signing/pagination/extraction) |
| layer3-code-adapters.md | CodeAdapter interface + 5 real adapter examples |
| compiler-pipeline.md | 4-phase pipeline (Capture → Analyze → Classify → Emit) |
| browser-integration.md | CDP connection, multi-source capture, JSONL format |
| runtime-executor.md | 7-step execution pipeline, mode escalation |
| pattern-library.md | 103 OpenTabs plugins classified into L1/L2/L3 |
| skill-package-format.md | Package layout (manifest + openapi + asyncapi + adapters) |
| gap-coverage-matrix.md | 12 design gaps mapped to layers/primitives |
| security-taxonomy.md | Probing protocol, risk tiers, SSRF protection |
| self-evolution.md | Pattern library growth, L3→L2 promotion |

Chinese summaries: [doc/todo/v2/cn/](../todo/v2/cn/)
