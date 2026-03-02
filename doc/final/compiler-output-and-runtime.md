# Compiler Output & Runtime Interface — Design from First Principles

> **Status**: Draft v2.0
> **Date**: 2026-03-02
> **Supersedes**: v1.0 (custom tool definition format), D2.1 (MCP-first Runtime)
> **Context**: Informed by research on Playwright CLI/MCP, mitmproxy2swagger, LLM tool schema formats, Agent Skills standard, and first-principles analysis of API specification formats

---

## 0. The Question

What should the compiler produce, and how should agents consume it?

v1.0 of this document proposed a custom JSON tool definition format with an `execution` block containing `body_template`, `verify`, and `ui_fallback`. Iterative review revealed that this intermediate layer duplicates information that standard API specification formats already describe. This v2.0 re-derives the answer with that lesson learned.

---

## 1. First-Principles Analysis

### 1.1 What Does the Compiler Actually Produce?

Strip away all framework jargon. The compiler watches browser traffic and produces:

1. **A list of things the website can do** (endpoints / operations)
2. **How to ask it to do each thing** (parameters, their types, their meanings)
3. **What it gives back** (response structure)
4. **What execution prerequisites exist** (cookies, CSRF, browser context, human intervention)

Items 1-3 are an **API specification**. Item 4 is **execution metadata** — openweb-specific information about how to make requests succeed.

### 1.2 What Does the Agent Need?

An AI agent consuming openweb tools needs exactly three capabilities:

| Capability | When | Token budget |
|---|---|---|
| **Discover** | "What can this site do?" | Minimal — just names + one-liners |
| **Understand** | "How do I use tool X?" | Medium — parameters and response for one tool |
| **Execute** | "Do X with these args, give me the result" | Zero schema — just the call and the JSON response |

The critical insight: **these three operations have wildly different token costs, and they happen at different times.** Any design that forces the agent to load everything upfront (like MCP tool registration or dumping a full OpenAPI spec) wastes the scarcest resource — context window.

### 1.3 The Right Abstraction Level

The agent doesn't care about:
- HTTP methods, URL paths, headers (execution detail)
- CSRF extraction logic (execution detail)
- Whether the call goes through `fetch()` in a browser or `curl` (execution detail)

The agent cares about:
- Name of the operation
- What parameters to provide (and their types/descriptions)
- What comes back
- Whether it might need human help

**But this doesn't mean the canonical format must hide HTTP details.** It means the **CLI presentation layer** should hide them. The underlying data format can and should use a standard API specification format — the CLI controls what the agent sees.

This is the mistake v1.0 made: it confused **presentation** (what the agent sees) with **representation** (how the data is stored). V1.0 invented a custom format to hide HTTP details, but that format duplicated information that OpenAPI already describes — with an extra `body_template` layer that mapped parameters to HTTP requests redundantly.

### 1.4 OpenAPI as Canonical Format

OpenAPI 3.1 describes exactly what the compiler produces:
- **Operations** (`operationId` + `summary`) = things the website can do
- **Parameters + Request Body** (JSON Schema) = how to call it
- **Responses** (JSON Schema) = what comes back
- **Standard format** that humans, tools, and LLMs already understand

What OpenAPI does NOT describe:
- Execution mode (`direct_http` / `session_http` / `browser_fetch`)
- Session management (CSRF extraction, cookie handling)
- Human handoff flag

These are openweb-specific annotations. OpenAPI has a standard mechanism for this: **vendor extensions** (`x-openweb-*`).

**Resolution: OpenAPI 3.1 + `x-openweb` extensions is the canonical compiler output.** No custom intermediate format. The CLI provides progressive disclosure to keep agent context minimal.

**Why v1.0 was wrong about OpenAPI:**

| v1.0 Concern | Why it doesn't hold |
|---|---|
| "OpenAPI is the wrong abstraction level for agents" | The CLI is the abstraction level for agents. OpenAPI is the storage format. |
| "Verbose (paths, methods, servers, components)" | Agent never reads raw OpenAPI — CLI presents it progressively. |
| "No per-tool self-containment" | One spec per site is standard; CLI extracts per-operation views. |
| "HTTP detail exposure" | HTTP details need to exist somewhere. In OpenAPI vs `body_template`, same information, but OpenAPI has zero duplication. |
| "Poor fit for GraphQL" | GraphQL operations are just POST to `/graphql` with requestBody. OpenAPI describes this naturally. |

---

## 2. The Design

### 2.1 Canonical Format: OpenAPI 3.1 + Runtime Extensions

The compiler's canonical output per site is a standard OpenAPI 3.1 spec with `x-openweb` vendor extensions for runtime metadata.

```yaml
openapi: "3.1.0"
info:
  title: Google Flights
  description: Auto-extracted API for Google Flights
  version: "1.0.0"
  x-openweb:
    spec_version: "0.1.0"
    generated_at: "2026-03-02T12:00:00Z"
    requires_auth: true
    fingerprint:
      js_bundle_hash: "sha256:a1b2c3..."
      api_endpoint_set_hash: "sha256:d4e5f6..."
      last_validated: "2026-03-02T12:00:00Z"

servers:
  - url: https://www.google.com

paths:
  /travel/flights/api/search:
    post:
      operationId: search_flights
      summary: Search for flights between two airports on a given date
      x-openweb:
        mode: session_http
        human_handoff: false
        session:
          csrf: "document.querySelector('meta[name=csrf]').content"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                origin:
                  type: string
                  description: "IATA airport code (e.g., SFO)"
                dest:
                  type: string
                  description: "IATA airport code (e.g., JFK)"
                date:
                  type: string
                  format: date
                  description: "Departure date (YYYY-MM-DD)"
                passengers:
                  type: integer
                  default: 1
              required: [origin, dest, date]
      responses:
        "200":
          description: Flight search results
          content:
            application/json:
              schema:
                type: object
                properties:
                  flights:
                    type: array
                    items:
                      type: object
                      properties:
                        offer_id: { type: string }
                        airline:  { type: string }
                        price:    { type: number }
                        stops:    { type: integer }

  /travel/flights/api/details/{offer_id}:
    get:
      operationId: get_details
      summary: Get fare details for a specific flight offer
      x-openweb:
        mode: session_http
        human_handoff: false
      parameters:
        - name: offer_id
          in: path
          required: true
          schema:
            type: string
          description: "Flight offer ID from search results"
      responses:
        "200":
          description: Flight fare details
          content:
            application/json:
              schema:
                type: object
                properties:
                  fare_key: { type: string }
                  cabin_class: { type: string }
                  baggage: { type: string }
                  refundable: { type: boolean }
```

**What this eliminates vs v1.0:**

| v1.0 construct | Status | Why |
|---|---|---|
| Custom tool definition JSON format | Eliminated | OpenAPI describes the same information in a standard format |
| `body_template` | Eliminated | `requestBody.schema` IS the request schema — zero duplication |
| `execution.request` (method, url, headers) | Eliminated | OpenAPI `paths` + `servers` describe this natively |
| `verify` expression | Eliminated (v1.1) | Response schema validates responses |
| `ui_fallback` | Eliminated (v1.1) | Separate artifact (see section 4.4) |
| `parameters` vs `body_template` duplication | Eliminated | Parameters described once, in standard OpenAPI locations |

**What `x-openweb` adds (non-duplicative, genuinely new information):**

| Extension | Purpose | Example |
|---|---|---|
| `x-openweb.mode` | Execution strategy | `session_http` |
| `x-openweb.human_handoff` | Requires human intervention | `false` |
| `x-openweb.session.csrf` | CSRF token extraction | `document.querySelector(...)` |
| `x-openweb.spec_version` | openweb format version | `"0.1.0"` |
| `x-openweb.fingerprint` | Change detection hashes | `{ js_bundle_hash, ... }` |

These annotations carry information that OpenAPI does not describe, with zero overlap.

**Multi-domain sites:** Some sites make API requests to multiple domains (e.g., `amazon.com` + `api.amazon.com` + `aws.com`, or `chatgpt.com` + `api.openai.com`). OpenAPI handles this via per-operation `servers` overrides:

```yaml
servers:
  - url: https://www.amazon.com          # default

paths:
  /api/search:
    get:
      operationId: search_products       # uses default server

  /recommendations:
    get:
      operationId: get_recommendations
      servers:
        - url: https://api.amazon.com    # different domain for this operation
```

All operations in one spec, regardless of how many backend domains they hit.

### 2.2 Package Structure

```
google-flights/
├── manifest.json          # Dependency graph, site metadata beyond OpenAPI
├── openapi.yaml           # OpenAPI 3.1 spec (canonical compiler output)
├── extractors/            # Complex session/CSRF extraction scripts (optional)
│   └── csrf.js
└── tests/                 # Recorded inputs → expected response schema
    └── search_flights.test.json
```

Four items. Each earns its place:
- `manifest.json` — dependency graph (`A.response.X -> B.request.Y`), cannot be expressed in OpenAPI
- `openapi.yaml` — the core product
- `extractors/` — only when inline expressions aren't enough (rare)
- `tests/` — regression safety net

**What changed from v1.0:**
- `tools/` directory (one JSON per tool) replaced by `openapi.yaml` (one standard spec per site)
- `manifest.json` now only contains what OpenAPI cannot: inter-operation dependency graph and site-level metadata

**File splitting:** The default is one `openapi.yaml` per site — shared `servers`, `info.x-openweb` (fingerprint etc.), and `components/schemas` avoid repetition across operations. For sites with many operations (100+), the spec can be split into multiple files using OpenAPI's standard `$ref` mechanism:

```yaml
# openapi.yaml (main file)
paths:
  /flights/search:
    $ref: './paths/search_flights.yaml'
  /flights/details:
    $ref: './paths/get_details.yaml'
components:
  schemas:
    Flight:
      $ref: './schemas/flight.yaml'
```

This is a packaging decision, not a format limitation. The CLI reads all `*.yaml` in the package directory. For MVP, single file per site is sufficient.

### 2.3 Derived Formats (From OpenAPI)

The canonical OpenAPI spec can be mechanically transformed to any LLM tool format:

| Target | Transformation | Use case |
|---|---|---|
| **OpenAI function** | Extract `operationId` -> `name`, `summary` -> `description`, `requestBody.schema` -> `parameters` | GPT agents |
| **Anthropic tool** | Same extraction, rename to `input_schema` | Claude direct API |
| **MCP tool** | Same extraction, rename to `inputSchema`, map response schema -> `outputSchema` | MCP servers |
| **Gemini function** | Same extraction | Gemini agents |
| **SKILL.md** | Generate name/summary list + CLI usage examples | Agent Skills ecosystem |

These are all mechanical extractions from the OpenAPI spec. No custom intermediate format needed.

### 2.4 The CLI: Progressive Spec Navigator + Executor

The CLI is a single binary that serves ALL sites. It has two roles:

**Role 1: Spec Navigator** (progressive disclosure for context-window efficiency)

The agent never reads raw OpenAPI. The CLI extracts and presents information progressively:

```bash
# What sites are available?
$ openweb sites
google-flights    3 tools    session_http
amazon            23 tools   browser_fetch

# What can this site do? (operationIds + summaries only)
$ openweb google-flights
search_flights        Search flights between two airports
get_details           Get fare details for a flight offer
price_graph           Monthly price calendar for a route

# How do I use this tool? (parameters + response summary)
$ openweb google-flights search_flights
POST /travel/flights/api/search
  origin:      string  IATA airport code (e.g., SFO)  [required]
  dest:        string  IATA airport code (e.g., JFK)  [required]
  date:        date    Departure date (YYYY-MM-DD)     [required]
  passengers:  int     default 1
Returns: { flights: [{ offer_id, airline, price, stops }] }
Mode: session_http

# Full OpenAPI operation (for debugging)
$ openweb google-flights search_flights --full
[prints the full OpenAPI path operation YAML]

# Just one parameter (for tools with many params)
$ openweb amazon search --param price_range
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

That's a **10x reduction** in context usage. The savings come from the CLI presentation layer, not the underlying format.

**The compact view is a runtime transform, not a persisted file.** The CLI reads `openapi.yaml` and applies a deterministic formatting function that strips OpenAPI boilerplate (`requestBody → content → application/json → schema` nesting, `responses → "200" → ...`, etc.) and emits only agent-relevant information. This view is never written to disk because:
- It's a pure function of `openapi.yaml` — same input always produces same output
- Persisting it would create two files to keep in sync (bug surface for self-healing updates)
- The transform is cheap (parse YAML + extract fields)
- Its only consumer is CLI stdout → agent context window

The compact view is more token-efficient than either raw JSON or raw YAML of the same information: ~120 tokens for one operation vs ~300 (JSON) or ~250 (YAML), because it discards all structural boilerplate and presents only semantically meaningful content.

**Role 2: Executor**

```bash
$ openweb google-flights exec search_flights '{"origin":"SFO","dest":"JFK","date":"2026-04-01"}'
{"flights":[{"offer_id":"f1","airline":"United","price":342,"stops":0}, ...]}
```

The executor:
1. Reads the OpenAPI operation for `search_flights`
2. Constructs the HTTP request from OpenAPI path/method/requestBody definitions + agent-provided parameters
3. Based on `x-openweb.mode`, applies session management (cookies, CSRF) or browser context
4. Makes the request
5. Validates response against the OpenAPI response schema
6. Returns JSON to stdout

If the primary mode fails, it escalates (direct_http -> session_http -> browser_fetch -> human_handoff) transparently.

**Why a CLI and not a library?**

For MVP, a CLI is simpler and sufficient. Every coding agent (Claude Code, Codex, Cursor, Copilot) can call CLI commands via bash. A library import adds a language dependency. CLI is also debuggable by humans.

### 2.5 SKILL.md Generation (For Agent Skills Ecosystem)

SKILL.md is NOT part of the compiler output. It is generated when the user *installs* a openweb package into an agent's workspace:

```bash
$ openweb install google-flights
# Creates: .claude/skills/google-flights/SKILL.md
```

Generated from the OpenAPI spec (`operationId` + `summary` -> tool list, parameter names -> usage examples):

```yaml
---
name: google-flights
description: >
  Search flights, check prices, and get fare details on Google Flights.
  Use when the user needs flight information, price comparisons, or booking details.
allowed-tools: Bash(openweb:*)
---
```

```markdown
# Google Flights

## Available Tools
- `search_flights` — Search flights between two airports
- `get_details` — Fare details for a flight offer
- `price_graph` — Monthly price calendar for a route

## Usage
openweb google-flights exec search_flights '{"origin":"SFO","dest":"JFK","date":"2026-04-01"}'

## Discovery
Run `openweb google-flights` to see all tools with parameters.
Run `openweb google-flights <tool>` to see detailed parameter info.
```

---

## 3. Architectural Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                    COMPILER (build-time)                          │
│                                                                   │
│  Phase 1: Record (C-HAR)                                         │
│  Phase 2: Analyze (cluster, classify params, infer schema)       │
│  Phase 3: Probe  (find cheapest execution mode)                  │
│  Phase 4: Generate (OpenAPI spec + tests)                        │
│                                                                   │
│  Output: skill package (manifest.json + openapi.yaml + tests/)   │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                  SKILL PACKAGE (data artifact)                    │
│                                                                   │
│  manifest.json              ← dependency graph, site metadata    │
│  openapi.yaml               ← OpenAPI 3.1 + x-openweb         │
│  extractors/                   extensions (canonical output)     │
│  tests/                                                          │
└──────────────────────────┬───────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│   CLI        │  │  LLM Tool    │  │  Install         │
│              │  │  Schemas     │  │                   │
│  sites       │  │              │  │  → SKILL.md      │
│  <site>      │  │  → OpenAI    │  │    (generated     │
│  <site> <t>  │  │  → Anthropic │  │     for target    │
│  exec <t>    │  │  → MCP       │  │     agent)        │
│              │  │  → Gemini    │  │                   │
│  Navigator   │  │              │  │                   │
│  + Executor  │  │  Mechanical  │  │  Distribution     │
│              │  │  extraction  │  │                   │
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

Microsoft's Playwright team explicitly moved from MCP-only to CLI+Skills because of token efficiency. The Agent Skills standard now has 30+ agent integrations.

**openweb's position:**
- The **compiler** operates at Layer 0 (observes HTTP/browser) and produces output in standard OpenAPI format.
- The **CLI** bridges OpenAPI -> Layer 2 (progressive navigation + execution).
- The **install** command bridges OpenAPI -> Layer 3 (generates SKILL.md for agent ecosystems).
- **LLM tool schema extraction** bridges OpenAPI -> Layer 1 (OpenAI, Anthropic, MCP, Gemini formats).

### 4.2 KISS Audit

| Concern | Design choice | Why it's simple |
|---|---|---|
| Canonical format | OpenAPI 3.1 (standard) | No custom format to learn, existing tooling works |
| OpenAPI verbosity | CLI compact view (runtime transform) | Agent never sees raw OpenAPI nesting; compact view is ~120 tokens vs ~300 raw JSON |
| Runtime metadata | `x-openweb` vendor extensions | Standard OpenAPI extension mechanism |
| Agent interface | CLI with 4 commands | `sites`, `<site>`, `<site> <tool>`, `exec <tool>` |
| Schema language | JSON Schema (via OpenAPI 3.1) | Universal across all LLM providers |
| LLM tool schemas | Mechanical extraction from OpenAPI | ~10 lines each, no business logic |
| SKILL.md | Generated on install from OpenAPI | Separation of concerns |
| MCP support | Optional adapter over same executor | Not privileged, not mandatory |
| Package structure | 4 items (manifest + openapi + extractors + tests) | Each earns its place |
| Multi-domain sites | Per-operation `servers` override | Standard OpenAPI mechanism |
| Large sites (100+ ops) | `$ref` file splitting | Standard OpenAPI mechanism, MVP uses single file |
| Parameter duplication | Zero | Parameters described once in OpenAPI, used for both discovery and execution |

### 4.3 What About GraphQL/Protobuf?

From the browser's traffic perspective, GraphQL is a POST to `/graphql` with a JSON body. The compiler sees HTTP requests. OpenAPI describes this naturally:

```yaml
/graphql:
  post:
    operationId: search_products
    summary: Search products in catalog
    x-openweb:
      mode: session_http
      type: graphql        # tells CLI to extract variables as agent params
    requestBody:
      content:
        application/json:
          schema:
            type: object
            properties:
              query:
                type: string
                const: "query SearchProducts($q: String!, $limit: Int) { ... }"
              variables:
                type: object
                properties:
                  q:     { type: string, description: "Search query" }
                  limit: { type: integer, default: 10 }
                required: [q]
```

The `x-openweb.type: graphql` annotation tells the CLI that agent-facing parameters are inside `variables`, not the full request body. The CLI presents it cleanly:

```
$ openweb example search_products
POST /graphql (GraphQL)
  q:      string  Search query  [required]
  limit:  int     default 10
Returns: { data: { search: { edges: [{ node: { id, name, price } }] } } }
```

The agent sees clean parameters. The executor handles the GraphQL wrapping.

**Protobuf/gRPC-Web**: From the wire, it's HTTP POST with binary content. The compiler extracts the protobuf schema. The OpenAPI spec describes the JSON-equivalent parameters, and the executor handles protobuf serialization — this is a content-type handler in the executor, not a spec format issue.

**WebSocket**: Out of scope for MVP. AsyncAPI exists for event-driven APIs if needed later.

### 4.4 Tool Definitions vs. UI Procedures

OpenAPI operations are **atomic, deterministic API calls**. Given the same parameters, the executor runs the same HTTP request and returns structured data.

UI automation procedures ("go to this page, type X in field Y, click Z") are a fundamentally different thing:
- **Non-deterministic**: page layout can change, elements may load asynchronously, selectors may break
- **Require agent reasoning**: deciding which element to interact with, handling popups, waiting for state changes
- **Browser-use-style**: these are instructions for a browser automation agent, not a programmatic executor

These two concepts do not belong in the same artifact.

**Where UI procedures live (if needed):**
- Separate markdown files in the skill package (e.g., `procedures/search_flights.md`)
- Written as natural-language agent instructions, not in the OpenAPI spec
- Consumed by a browser-use agent when all API-level execution modes fail
- Optional — many operations will never need them

---

## 5. Relationship to Existing Documents

| Document | Impact |
|---|---|
| **openweb-design.md** | D2.1 updated: canonical output is now OpenAPI + extensions. CLI-first runtime unchanged. |
| **skill-package-format.md** | Package structure updated: `tools/` -> `openapi.yaml`. Tool definition format -> OpenAPI operations. |
| **architecture-pipeline.md** | Phase 4 output format updated to OpenAPI. Runtime reads OpenAPI operations. |
| **security-taxonomy.md** | No change. Execution modes map to `x-openweb.mode`. |
| **self-evolution.md** | No change. Knowledge base operates on operations regardless of format. |

---

## 6. Open Questions

1. **CLI executor implementation**: Should the executor be a long-running daemon (better performance, keeps browser sessions warm) or a per-invocation process (simpler, stateless)? The daemon approach is probably needed for `session_http` and `browser_fetch` modes.

2. **CLI binary distribution**: Node.js for consistency with Playwright, or a compiled binary (Rust/Go) for faster startup? For MVP, Node.js with `npx openweb` is pragmatic.

3. **OpenAPI spec format**: YAML (more readable, standard for OpenAPI) or JSON (easier to parse programmatically)? Lean toward YAML for readability with JSON as alternative output.

4. **GraphQL parameter extraction**: Use `x-openweb.type: graphql` annotation, or auto-detect from `const` query field + variables pattern? Auto-detection is simpler if reliable.
