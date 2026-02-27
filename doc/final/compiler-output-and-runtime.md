# Compiler Output & Runtime Interface — Design from First Principles

> **Status**: Draft v1.0
> **Date**: 2026-02-27
> **Supersedes**: D2.1 (MCP-first Runtime) and portions of skill-package-format.md
> **Context**: Informed by research on Playwright CLI/MCP, mitmproxy2swagger, LLM tool schema formats (OpenAI/Anthropic/Gemini/MCP), Agent Skills standard (agentskills.io), and Vercel skills CLI

---

## 0. The Question

What should the compiler produce, and how should agents consume it?

The previous design said "MCP-first runtime, Skills-on-top." This document re-derives the answer from first principles, because the ecosystem moves fast and any answer coupled to a specific framework will age poorly.

---

## 1. First-Principles Analysis

### 1.1 What Does the Compiler Actually Produce?

Strip away all framework jargon. The compiler watches browser traffic and produces:

1. **A list of things the website can do** (endpoints / operations)
2. **How to ask it to do each thing** (parameters, their types, their meanings)
3. **What it gives back** (response structure)
4. **What execution prerequisites exist** (cookies, CSRF, browser context, human intervention)

That's it. Items 1-3 are an **API specification**. Item 4 is **execution metadata** — it tells a runtime *how* to actually make the request succeed.

### 1.2 What Does the Agent Need?

An AI agent consuming web-skill tools needs exactly three capabilities:

| Capability | When | Token budget |
|---|---|---|
| **Discover** | "What can this site do?" | Minimal — just names + one-liners |
| **Understand** | "How do I use tool X?" | Medium — parameters and response for one tool |
| **Execute** | "Do X with these args, give me the result" | Zero schema — just the call and the JSON response |

The critical insight: **these three operations have wildly different token costs, and they happen at different times.** Any design that forces the agent to load everything upfront (like MCP tool registration) wastes the scarcest resource — context window.

### 1.3 What Is the Minimal Correct Abstraction?

The agent doesn't care about:
- HTTP methods, URL paths, headers (execution detail)
- CSRF extraction logic (execution detail)
- Whether the call goes through `fetch()` in a browser or `curl` (execution detail)
- OpenAPI vs JSON Schema vs custom format (serialization detail)

The agent cares about:
- Name of the operation
- What parameters to provide (and their types/descriptions)
- What comes back
- Whether it might need human help

**Therefore: the interface between compiler and agent should be at the semantic level (operations + parameters), not the protocol level (HTTP + headers).**

### 1.4 Where Does OpenAPI Fit?

OpenAPI is a specification for HTTP APIs. It describes endpoints in terms of paths, methods, headers, request bodies, and response bodies. This is the **wrong abstraction level for AI agents** — agents think in terms of "search for flights" not "POST /api/v2/travel/flights/search with Content-Type application/json."

However, OpenAPI has enormous practical value:
- It's a standard format that humans and tools understand
- mitmproxy2swagger already produces it
- It can serve as documentation, Swagger UI, Postman import
- LLMs have seen billions of tokens of OpenAPI in training

**Resolution: OpenAPI is a valid *export format* for interoperability, but it is NOT the canonical representation.** The canonical representation is simpler and more agent-native.

---

## 2. The Design

### 2.1 Canonical Format: Tool Definitions (JSON Schema Core)

Every LLM provider (OpenAI, Anthropic, Google, MCP) converges on the same core for tool definitions:

```
{ name, description, parameters: <JSON Schema object> }
```

The field naming varies (`parameters` vs `input_schema` vs `inputSchema`), but the semantic content is identical. JSON Schema IS the universal language all providers agree on.

The compiler's canonical output per tool is:

```jsonc
{
  // === Agent-facing (the spec) ===
  "name": "search_flights",
  "description": "Search for flights between two airports on a given date",
  "parameters": {                    // JSON Schema Draft 2020-12
    "type": "object",
    "properties": {
      "origin":         { "type": "string", "description": "IATA code, e.g. SFO" },
      "destination":    { "type": "string", "description": "IATA code, e.g. JFK" },
      "departure_date": { "type": "string", "format": "date" },
      "passengers":     { "type": "integer", "default": 1 }
    },
    "required": ["origin", "destination", "departure_date"]
  },
  "returns": {                       // JSON Schema for response
    "type": "object",
    "properties": {
      "flights": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "offer_id": { "type": "string" },
            "airline":  { "type": "string" },
            "price":    { "type": "number" },
            "stops":    { "type": "integer" }
          }
        }
      }
    }
  },

  // === Execution-facing (the recipe) ===
  "execution": {
    "mode": "session_http",          // direct_http | session_http | browser_fetch
    "human_handoff": false,
    "request": {
      "method": "POST",
      "url": "https://www.google.com/travel/flights/api/search",
      "headers": { "content-type": "application/json" },
      "body_template": { "origin": "{origin}", "dest": "{destination}", "date": "{departure_date}" }
    },
    "session": {                     // only for session_http / browser_fetch
      "csrf": "document.querySelector('meta[name=csrf]').content"
    },
    "verify": "Array.isArray(response.flights) && response.flights.length >= 0",
    "ui_fallback": [                 // natural-language steps for browser automation fallback
      "Navigate to https://www.google.com/travel/flights",
      "Enter {origin} in 'Where from?'",
      "Enter {destination} in 'Where to?'",
      "Select {departure_date}",
      "Click Search"
    ]
  }
}
```

**What changed from previous design:**

| Before | After | Why |
|---|---|---|
| `input_schema` | `parameters` | Matches OpenAI/Gemini naming; trivially renamed for Anthropic (`input_schema`) and MCP (`inputSchema`) at export time |
| `output_schema` | `returns` | Shorter, more intuitive. "What does this tool return?" |
| Separate `api` + `ui_fallback` nesting | Flat `execution` block | One level less nesting. KISS. |
| `csrf_extractor` as separate field | `session.csrf` | Groups all session-related config together |

**Why not OpenAPI as canonical:**

| Concern | OpenAPI | Tool definition JSON |
|---|---|---|
| Agent readability | Verbose (paths, methods, servers, components) | Direct (name + params + returns) |
| Schema language | JSON Schema (same) | JSON Schema (same) |
| Per-tool self-containment | No — refs, shared components, path hierarchy | Yes — one file = one tool, everything included |
| HTTP detail exposure | By design | Encapsulated in `execution` block |
| Multi-protocol (GraphQL, WS) | Poor fit | Protocol-agnostic `execution` block |
| Export to OpenAPI | Mechanical transformation | — |

### 2.2 Package Structure

```
google-flights/
├── manifest.json          # Site metadata, fingerprint, tool dependency graph
├── tools/                 # One file per tool (canonical format above)
│   ├── search_flights.json
│   ├── get_details.json
│   └── price_graph.json
├── extractors/            # Complex session/CSRF extraction scripts (optional)
│   └── csrf.js
└── tests/                 # Recorded inputs → expected output schema
    └── search_flights.test.json
```

Four items. Each earns its place:
- `manifest.json` — can't derive site metadata from tool files alone
- `tools/` — the core product
- `extractors/` — only when inline expressions aren't enough (rare)
- `tests/` — regression safety net

**What was removed from previous design:**
- `SKILL.md` — moved to the CLI layer (see 2.4). The skill package is a data artifact, not a distribution package. SKILL.md is generated by the CLI `init` or `install` command when deploying to an agent, not by the compiler.
- `wrappers/` — unnecessary. The CLI generates agent-specific formats on demand.

### 2.3 Export Formats (Generated, Not Canonical)

The canonical `tools/*.json` can be mechanically transformed to any target:

| Target | Transformation | Use case |
|---|---|---|
| **OpenAPI 3.1** | Wrap each tool as a path operation | Documentation, Swagger UI, Postman |
| **OpenAI function** | `{ type: "function", function: { name, description, parameters } }` | GPT agents |
| **Anthropic tool** | Rename `parameters` → `input_schema` | Claude direct API |
| **MCP tool** | Rename `parameters` → `inputSchema`, add `outputSchema` from `returns` | MCP servers |
| **SKILL.md** | Generate name/description summary + usage examples | Agent Skills ecosystem |

These are all ~10-line format converters. No business logic. The compiler doesn't need to know about them.

### 2.4 The CLI: Progressive Spec Navigator + Executor

The CLI is a single binary that serves ALL sites. It has two roles:

**Role 1: Spec Navigator** (progressive disclosure for context-window efficiency)

```bash
# What sites are available?
$ web-skill sites
google-flights    3 tools    session_http
amazon            23 tools   browser_fetch

# What can this site do? (names + one-liners only)
$ web-skill google-flights
search_flights        Search flights between two airports
get_details           Get fare details for a flight offer
price_graph           Monthly price calendar for a route

# How do I use this tool? (parameters + returns summary)
$ web-skill google-flights search_flights
search_flights(origin, destination, departure_date, [passengers=1])
  origin:         string  IATA code, e.g. SFO
  destination:    string  IATA code, e.g. JFK
  departure_date: date    YYYY-MM-DD
  passengers:     int     default 1
Returns: { flights: [{ offer_id, airline, price, stops }] }
Mode: session_http

# Full detail (for debugging, or when agent needs response schema)
$ web-skill google-flights search_flights --full
[prints complete tool JSON including execution block]

# Just one parameter (for tools with many params like amazon search)
$ web-skill amazon search --param price_range
price_range: object
  min: number (USD, default: 0)
  max: number (USD, default: unlimited)
```

**Token cost comparison:**

| Approach | Tokens to discover + use 1 tool from a 23-tool site |
|---|---|
| MCP (all schemas loaded) | ~3000-5000 tokens upfront |
| Full OpenAPI spec | ~5000-10000 tokens |
| CLI progressive | ~50 (site list) + ~200 (tool list) + ~150 (one tool detail) = **~400 tokens** |

That's a **10x reduction** in context usage.

**Role 2: Executor**

```bash
$ web-skill google-flights search_flights '{"origin":"SFO","destination":"JFK","departure_date":"2026-04-01"}'
{"flights":[{"offer_id":"f1","airline":"United","price":342,"stops":0}, ...]}
```

The executor:
1. Reads the tool definition from `tools/search_flights.json`
2. Based on `execution.mode`, chooses execution strategy
3. Handles session management (cookies, CSRF) transparently
4. Makes the request
5. Validates response against `returns` schema
6. Returns JSON to stdout

If the primary mode fails, it escalates (direct_http → session_http → browser_fetch → human_handoff) transparently.

**Why a CLI and not a library?**

For MVP, a CLI is simpler and sufficient. Every coding agent (Claude Code, Codex, Cursor, Copilot) can call CLI commands via bash. A library import adds a language dependency. CLI is also debuggable by humans.

A Node.js library can be extracted later if needed — the executor logic is the same either way. The CLI is just `executor.run(site, tool, args)` with a thin argument parser on top.

### 2.5 SKILL.md Generation (For Agent Skills Ecosystem)

SKILL.md is NOT part of the compiler output. It is generated when the user *installs* a web-skill package into an agent's workspace:

```bash
# Install a compiled skill into the current agent workspace
$ web-skill install google-flights

# This creates:
# .claude/skills/google-flights/SKILL.md  (or .cursor/skills/ etc.)
```

Generated SKILL.md follows the Agent Skills standard:

```yaml
---
name: google-flights
description: >
  Search flights, check prices, and get fare details on Google Flights.
  Use when the user needs flight information, price comparisons, or booking details.
allowed-tools: Bash(web-skill:*)
---
```

```markdown
# Google Flights

## Available Tools
- `search_flights(origin, dest, date)` — Search flights
- `get_details(offer_id)` — Fare details for a flight
- `price_graph(origin, dest, month)` — Monthly price calendar

## Usage
web-skill google-flights search_flights '{"origin":"SFO","destination":"JFK","departure_date":"2026-04-01"}'

## Discovery
Run `web-skill google-flights` to see all tools.
Run `web-skill google-flights <tool>` to see parameters.
```

This is ~15 lines. The agent reads it, knows what's available, knows how to call the CLI. Progressive discovery via CLI commands keeps context minimal.

---

## 3. Architectural Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                    COMPILER (build-time)                          │
│                                                                   │
│  Phase 1: Record (C-HAR)                                         │
│  Phase 2: Analyze (cluster, classify params, infer schema)       │
│  Phase 3: Probe  (find cheapest execution mode)                  │
│  Phase 4: Generate (tool definitions + tests)                    │
│                                                                   │
│  Output: skill package (manifest.json + tools/*.json + tests/)   │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                  SKILL PACKAGE (data artifact)                    │
│                                                                   │
│  manifest.json                                                    │
│  tools/search_flights.json    ← canonical tool definition        │
│  tools/get_details.json          (JSON Schema params + returns   │
│  tests/...                        + execution recipe)            │
└──────────────────────────┬───────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│   CLI        │  │  Export      │  │  Install         │
│              │  │              │  │                   │
│  sites       │  │  → OpenAPI   │  │  → SKILL.md      │
│  <site>      │  │  → OpenAI    │  │    (generated     │
│  <site> <t>  │  │  → Anthropic │  │     for target    │
│  <site> exec │  │  → MCP       │  │     agent)        │
│              │  │  → Gemini    │  │                   │
│  Navigator   │  │              │  │                   │
│  + Executor  │  │  Format      │  │  Distribution     │
│              │  │  converters  │  │                   │
└──────────────┘  └──────────────┘  └──────────────────┘
```

---

## 4. Why This Design

### 4.1 The Ecosystem Trajectory

Research shows the AI agent tooling ecosystem is stratifying into layers:

```
Layer 3: Skills (SKILL.md)     — Procedural knowledge, when-to-use triggers
Layer 2: CLI / Tool interfaces — Token-efficient command invocation
Layer 1: MCP / Function calls  — Structured tool schemas (typed I/O)
Layer 0: Raw HTTP / Browser    — Execution substrate
```

Microsoft's Playwright team explicitly moved from MCP-only to CLI+Skills because of token efficiency. The Agent Skills standard now has 30+ agent integrations. MCP remains valuable for agents without shell access, but coding agents increasingly bypass it.

**web-skill's position:**
- The **compiler** operates at Layer 0 (observes HTTP/browser) and produces output at Layer 1 (tool definitions with JSON Schema).
- The **CLI** bridges Layer 1 → Layer 2 (progressive navigation + execution).
- The **install** command bridges Layer 1 → Layer 3 (generates SKILL.md for agent ecosystems).
- **Export** bridges Layer 1 → any format (OpenAPI, provider-specific schemas, MCP).

This design is **layer-complete** without being coupled to any single layer.

### 4.2 KISS Audit

| Concern | Design choice | Why it's simple |
|---|---|---|
| Canonical format | One JSON file per tool | Self-contained, no cross-references, no inheritance |
| Agent interface | CLI with 4 commands | `sites`, `<site>`, `<site> <tool>`, `<site> exec <tool>` |
| Schema language | JSON Schema | Universal across all LLM providers, no custom DSL |
| Export | Mechanical transformers | ~10 lines each, no business logic |
| SKILL.md | Generated on install, not by compiler | Separation of concerns: compiler produces data, CLI produces agent packaging |
| MCP support | Optional adapter over same executor | Not privileged, not mandatory |
| Package structure | 4 items (manifest + tools + extractors + tests) | Each earns its place |

### 4.3 What About GraphQL/WebSocket/Protobuf?

The tool definition format is **protocol-agnostic at the agent-facing level** (name + parameters + returns). The protocol only matters inside the `execution` block.

```jsonc
// GraphQL tool — agent sees the same interface
{
  "name": "search_products",
  "description": "Search products",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "limit": { "type": "integer", "default": 10 }
    },
    "required": ["query"]
  },
  "returns": { /* same as REST */ },
  "execution": {
    "mode": "session_http",
    "request": {
      "method": "POST",
      "url": "https://api.example.com/graphql",
      "headers": { "content-type": "application/json" },
      "body_template": {
        "query": "query SearchProducts($q: String!, $limit: Int) { search(query: $q, first: $limit) { edges { node { id name price } } } }",
        "variables": { "q": "{query}", "limit": "{limit}" }
      }
    }
  }
}
```

The agent calls `search_products(query="laptop", limit=10)` regardless of whether the underlying protocol is REST, GraphQL, or gRPC-Web. The `execution` block handles the translation. **No special-casing needed. GraphQL is not an edge case — it's just a different execution recipe.**

This is the simplification the user asked for: edge cases becoming canonical cases through good abstraction.

---

## 5. Relationship to Existing Documents

| Document | Impact |
|---|---|
| **web-skill-design.md** | D2.1 changes from "MCP-first" to "CLI-first, format-agnostic." D2.2 "Compiler-First" is reinforced. Section 2.2 updated. |
| **skill-package-format.md** | Package structure simplified (SKILL.md removed from compiler output). Tool JSON format updated (field renames). MCP Server section becomes one option among many. |
| **architecture-pipeline.md** | Phase 4 output format updated. "Multi-Target Emission" simplified. No impact on Phases 1-3. |
| **security-taxonomy.md** | No change. Execution modes map directly to `execution.mode`. |
| **self-evolution.md** | No change. Knowledge base operates on tool definitions regardless of format. |

---

## 6. Open Questions

1. **CLI executor implementation**: Should the executor be a long-running daemon (better performance, keeps browser sessions warm) or a per-invocation process (simpler, stateless)? The daemon approach is probably needed for `session_http` and `browser_fetch` modes. Design: the first `exec` call starts a background daemon; subsequent calls communicate via local socket; the daemon auto-exits after idle timeout. The user should not need to manage the daemon lifecycle.

2. **CLI binary distribution**: Node.js for consistency with Playwright, or a compiled binary (Rust/Go) for faster startup? For MVP, Node.js with `npx web-skill` is pragmatic. If startup latency matters, consider compiling later.

3. **OpenAPI export**: Should the compiler also emit OpenAPI alongside the canonical tool JSONs? Or only on demand via `web-skill export openapi <site>`? On-demand is simpler. Skip for MVP.
