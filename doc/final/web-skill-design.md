# web-skill: Website-to-API Compiler — Aligned Design

> **Status**: Aligned Draft v1.1 (Claude initial + Codex turn 1)
> **Date**: 2026-02-27
> **Origin**: Synthesized from initial designs + Claude review + Codex review + web research

---

## 0. Mission

**Make any agent (Claude Code, OpenClaw, or any agent) access the web easily and smoothly.** That means: easy to use, fast, cheap.

---

## 1. The Problem

Every browser-use agent today reads a rendering artifact (DOM / a11y tree / screenshot) and issues low-level actions (click, type, scroll). This is fundamentally wrong because:

1. **The observation space is bloated.** Thousands of DOM nodes, hundreds of a11y elements, or vision-model-parsed screenshots — all consumed as tokens — for information the agent mostly doesn't need.
2. **The action space is fragile.** Click coordinates shift, CSS selectors break, multi-step forms need precise sequencing.
3. **Latency compounds.** Each tool call renders a page, waits for network, parses state, and decides the next click. 15+ tool calls for what a human does in 4 clicks.

**The key insight:** Every modern web app is an API client. Buttons and forms are wrappers around `fetch()` / `XMLHttpRequest`. The actual action space is already structured — it's just hidden behind the GUI.

**Evidence (Song et al., 2024, arXiv:2410.16464v3, updated June 2025):**

| Agent Type | Success Rate (WebArena) |
|---|---|
| Browser-only | 14.8% |
| API-only | 29.2% |
| Hybrid (API-first, browser-fallback) | **38.9%** |

That paper relied on manually curated official API documentation. **No one has demonstrated automatic extraction of API tool definitions from arbitrary websites.** That is what this project does.

---

## 2. Vision: Website → Tool Compiler

### 2.1 The Compiler Metaphor

```
Source     = Network traffic + UI behavior recording during browsing
Compiler   = web-skill pipeline (this project)
Target     = Per-website skill package (typed tool definitions)
Runtime    = Execution engine (browser session + fallback cascade)
```

A compiler is stateless per-invocation. It evolves its optimization database (knowledge base), not its core passes. This metaphor constrains the architecture correctly.

### 2.2 Relationship to Agent Skills, MCP, and WebMCP

These are different layers, not competing choices:

| Layer | What it is | Role in this project |
|---|---|---|
| **Agent Skills** | Reusable instruction/workflow packaging | UX and orchestration layer for each agent ecosystem |
| **MCP** | Tool transport protocol between agents and tool servers | Runtime interoperability backbone |
| **WebMCP** | Website-native tool exposure by site owners | Preferred when available; still early adoption |

As of late 2025:
- Anthropic introduced Skills on **2025-10-16** and published an open Agent Skills standard on **2025-12-18**.
- MCP remained actively versioned (spec update **2025-11-25**) and is broadly integrated by major agent clients.

Therefore the architecture is:
- **MCP-first for execution interoperability**
- **Skills-on-top for ease of use and agent-specific ergonomics**
- **WebMCP if a website natively provides tools**

| Situation | Strategy |
|---|---|
| Website implements WebMCP | Use native website tools first |
| Website has public API docs | Use official API directly |
| Website has no public API | **web-skill mines traffic, serves tools via MCP, wraps usage via Skills** |

### 2.3 Goals and Non-Goals

**Goals:**
1. Convert web tasks into API-like structured I/O calls wherever possible
2. Minimize low-level GUI operations (click/type/scroll)
3. Generate testable, versionable, self-contained per-website skill packages
4. Support any LLM agent as consumer (not just Claude Code)
5. Accumulate compounding knowledge across site builds

**Non-Goals:**
1. ~~100% API-ification of any website~~ → Graceful UI fallback for what resists
2. ~~Bypass authentication, CAPTCHA, or access controls~~ → Human-in-the-loop for these
3. ~~Unauthorized write operations~~ → Explicit user confirmation for irreversible actions
4. ~~Skill marketplace / distribution~~ → Per-user, per-device extraction only (legal risk)

### 2.4 Competitive Landscape: Why the Compiler Is the Product

The browser-control MCP space is already saturated:

| Product | What it does | Scale |
|---|---|---|
| **`@playwright/mcp`** (Microsoft) | Browser automation via accessibility snapshots, tab management, code generation | **1.3M weekly downloads**, 257 versions, official Playwright team |
| **Chrome DevTools MCP** (Google) | Browser debugging: performance traces, console logs, network diagnosis | Official Google, launched Sep 2025 |
| **browser-use** | LLM-driven browser automation via Playwright | 79k GitHub stars, Python |
| **playwright-mcp** (community) | DOM extraction, screenshots, JS execution for test writing | 5k weekly downloads |

**Critical insight from Microsoft's Playwright team** (from `@playwright/mcp` docs, Feb 2026):
> "Modern coding agents increasingly favor CLI-based workflows exposed as SKILLs over MCP because CLI invocations are more token-efficient: they avoid loading large tool schemas and verbose accessibility trees into the model context."

This validates our core thesis: **generic browser tools have an observation space problem.** The Playwright team themselves acknowledge that browser MCP tools bloat context with accessibility trees and tool schemas. The solution isn't "better browser MCP tools" — it's **compiled, typed, compact API tools** that give the agent exactly what it needs.

Building another generic browser-control MCP server (`open_page`, `act`, `observe`) competes with Microsoft's 1.3M-downloads/week product with zero differentiation. We lose that fight and shouldn't try.

**What no one has built:** Automatic extraction of typed API tool definitions from arbitrary website traffic. That's the compiler. That's our unique value. The runtime is just the serving layer for compiled tools — and it can leverage `@playwright/mcp` for fallback browser control when needed.

---

## 3. System Architecture (Overview)

The project cleanly separates into two independent systems:

| System | Phase | Characteristics |
|---|---|---|
| **Compiler** (build-time) | Runs once per site | Expensive, needs LLM, produces artifacts |
| **Runtime** (run-time) | Runs on every tool call | Must be fast, no LLM needed for basic execution |

```
┌──────────────────────────────────────────────────┐
│              COMPILER (build-time)                │
│                                                   │
│  Phase 1: Explore & Record (Agent + CDP)          │
│  Phase 2: Analyze & Extract (Cluster + Schema)    │
│  Phase 3: Probe (Escalation Ladder)               │
│  Phase 4: Generate & Test (Tools + SKILL.md)      │
│                                                   │
│  Inputs:  URL + browsing session                  │
│  Outputs: per-site skill package                  │
└───────────────────┬──────────────────────────────┘
                    │ produces
                    ▼
┌──────────────────────────────────────────────────┐
│          Per-Site Skill Package                    │
│  manifest.json + tools/*.json + tests/*.json      │
└───────────────────┬──────────────────────────────┘
                    │ consumed by
                    ▼
┌──────────────────────────────────────────────────┐
│              RUNTIME (run-time)                    │
│                                                   │
│  Tool Executor (escalating fallback)              │
│  MCP Server / HTTP API (for any agent)            │
│  Self-heal trigger (detect breakage → re-compile) │
│                                                   │
│  Inputs:  tool call + args                        │
│  Outputs: structured JSON response                │
└──────────────────────────────────────────────────┘
```

For detailed pipeline documentation, see the companion documents below.

---

## 4. Key Design Decisions

### D1: Three Execution Modes + Human Handoff Flag

Refined from both Claude's original 3-mode model and Codex's proposal:

| Mode | What it means | Resource cost |
|---|---|---|
| `direct_http` | No browser process needed. Pure HTTP client. | Lowest |
| `session_http` | HTTP with cookies from browser session. No live page context. | Low |
| `browser_fetch` | In-page `fetch()` in live browser page context. | Higher |

Plus a boolean flag: `human_handoff` — tool may require human intervention (CAPTCHA, 2FA, payment).

The internal escalation ladder handles all probing granularity. See [security-taxonomy.md](security-taxonomy.md) for the full protocol.

**Rationale:** The agent doesn't think about CSRF vs TLS fingerprint. It calls a tool and gets a result. But the runtime needs to know whether it can use a light HTTP client (`direct_http`), needs cookie management (`session_http`), or needs a live page (`browser_fetch`). `human_handoff` is orthogonal — a `browser_fetch` tool might sometimes need human help.

### D2: Escalation Ladder Probing (Not Per-Layer Taxonomy)

Try cheap execution modes first, escalate on failure. You don't need to know *which* security layer blocked you — you need to know *what execution mode works*. See [security-taxonomy.md](security-taxonomy.md) for details.

### D2.1: MCP-first Runtime, Skills-on-Top Distribution

The canonical runtime contract is MCP tool invocation. Skills are generated wrappers and usage guides for agent ecosystems.

Implications:
- One canonical tool schema and executor path
- Many optional UX wrappers (`SKILL.md`, `AGENTS.md`, or equivalent)
- No forked runtime logic per agent vendor

### D2.2: Compiler-First, Runtime-Thin

The compiler is the product. The runtime is the delivery mechanism.

**Why this matters strategically:**
- Without compiled tools, the runtime is just another `@playwright/mcp` (which has 1.3M weekly downloads — we can't and shouldn't compete).
- With compiled tools, the runtime serves typed, compact API calls that are 10x more efficient than DOM-based browser automation.
- The compiler creates the value; the runtime delivers it. Ship the compiler first.

**Practical implication:** MVP-1 builds the compiler pipeline for one easy site and ships a minimal MCP server in the same phase. The server exists only to serve compiled tools (load tool definitions, execute HTTP/fetch, verify response). It is NOT a generic browser-control layer — that already exists.

**Relationship to `@playwright/mcp`:** For `browser_fetch` mode and UI fallback execution, we can delegate to Playwright directly rather than building our own browser-control abstraction. Our MCP server manages tool execution; Playwright manages browser interaction.

### D3: Dual Execution Path (API + UI Fallback)

Every tool has both an API execution path and a UI fallback path. No automatic API extraction can guarantee 100% coverage.

### D4: Causal Recording (C-HAR)

Standard HAR captures *what*. C-HAR captures *why* — mapping UI events to the network requests they trigger. Without causality, can't distinguish user-triggered API calls from background noise.

### D5: LLM-in-the-Loop for Semantic Annotation

Use the LLM for classifying parameters, naming fields, and composing descriptions. Heuristics alone have limited recall.

### D6: Skill as Software Package (Not Prompt)

Per-website skill is a directory of structured files (JSON schemas, execution configs, tests), not a monolithic prompt. Diffable, testable, versionable, partially updatable.

### D7: No Workflow YAML DSL for MVP

Modern LLMs can compose tool sequences from tool descriptions + dependency graph. Pre-built workflow DAGs add a mini programming language without clear value when the consumer is an LLM. Add workflows later only if agents consistently fail at sequencing.

### D8: Self-Evolving Meta-Skill (Knowledge Base)

The compiler maintains a growing knowledge base (patterns, heuristics, extractors) updated after every site build. Declarative knowledge grows frequently; procedural knowledge changes only for systemic gaps. See [self-evolution.md](self-evolution.md).

---

## 5. Data Governance (Minimum Viable)

| Policy | Rule |
|---|---|
| Default data capture | Request/response + causality only. Screenshots/a11y on-demand. |
| Sensitive data | Never store plaintext passwords, payment info, OTP codes. |
| Log sanitization | Auto-redact tokens, cookies, PII in logs and history files. |
| Retention | Raw recordings deleted after skill generation. Only tool definitions + tests retained. |
| Write operation gate | High-risk writes (payment, account changes) require explicit user confirmation. |
| Site allowlist | Optional site-level allowlist/denylist for enterprise deployments. |

---

## 6. MVP Strategy

### MVP-1: Read-Only Skill for One Simple Site

**Target site:** NOT Google Flights (protobuf, TLS fingerprint — too hard for first site). Choose the simplest possible:
- A site with REST endpoints returning JSON
- No anti-bot, no auth required for read operations
- Candidates: weather service, public data portal, basic SaaS tool, or a simple e-commerce site with vanilla REST API

**Scope:**
- Recording: Playwright + CDP for 3-5 read flows
- Clustering: URL-based endpoint grouping
- Schema: Auto-inferred JSON Schema for responses
- Tools: 3-5 read-only tools
- Execution: Start with `direct_http`, escalate as needed
- Testing: 5 recorded queries as regression tests

**Not in scope:**
- Write operations, self-healing, workflows, multi-site
- GraphQL, WebSocket, protobuf

**Success criteria:**
An agent can call `search(query)` and receive accurate, structured data — without any browser click/type operations. Quantified comparison: step count, latency, and success rate vs. browser-only agent on the same tasks (at least 20 task replays).

### MVP-2: Add Moderate-Difficulty Site + Write Ops

- Second site with CSRF / cookie auth (escalation to `session_http` / `browser_fetch`)
- Read + limited write operations (add to cart, apply filter)
- Human-in-the-loop for payment
- Basic fingerprint-based change detection

### MVP-3: Google Flights + Self-Healing

- Hard site: protobuf, TLS fingerprint, complex session
- Self-healing pipeline (detect breakage → re-record → diff → patch)
- Knowledge base accumulation from 3+ sites

### MVP-4: Scale & Generalize

- 10+ sites across verticals
- Knowledge base proves compounding value
- HTTP API runtime (not just MCP)

### 90-Day Execution Plan

| Phase | Weeks | Focus | Exit Criteria |
|---|---|---|---|
| **A: Compiler MVP** | 1–3 | Record + cluster + emit tools for 1 easy site. Ship thin MCP runtime to serve compiled tools. Benchmark harness. | 3–5 read-only tools. Agent completes 20 tasks via API tools. Baseline metrics: success rate, latency, step count vs browser-only. |
| **B: Second Site + Write Ops** | 4–7 | Second site (moderate difficulty: CSRF/cookies). Write operations. Escalation ladder probing. Begin knowledge base. | 2 sites compiled, each ≥3 tools. Compiled tools beat browser-only on ≥2 of 3 metrics. |
| **C: Hardening + Third Site** | 8–12 | Third+ sites. Self-healing. Regression suite. Change gating. Second agent integration path. | 5–10-site batch. No critical regressions. Knowledge base shows measurable pattern reuse. |

**Why compiler-first (with runtime-thin):** A generic browser-control MCP server is `@playwright/mcp` (1.3M weekly downloads). We don't build what already exists. Our unique value—the compiler—ships first. The MCP serving layer for compiled tools is thin and ships alongside it.

---

## 7. Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| Browser automation | Playwright (Node.js) | Best CDP integration, cross-browser |
| Navigation agent | browser-use or equivalent | Proven LLM-driven browser automation framework |
| Traffic capture | CDP Network domain | Direct access to request/response + initiator stacks |
| Clustering bootstrap | mitmproxy2swagger (evaluate) | Existing HAR→OpenAPI conversion; adapt rather than rewrite |
| MCP server | Node.js (stdio transport) | Native Playwright integration, Claude Code support |
| Skill wrappers | Agent Skills format + generator templates | Publish the same capability in agent-native ergonomics |
| Schema inference | Custom + `json-schema-generator` | Need control over merging multiple samples |
| LLM for analysis | Claude (via API) | Semantic labeling, tool descriptions, parameter classification |
| Test runner | Node.js custom harness | Replay inputs, assert schema conformance |
| Skill storage | File system | Simple, versionable, portable |
| State storage (MVP) | File system | Session cookies, probe results, knowledge base |
| Concurrency (MVP) | Singleton browser, serial execution | Simplest correct approach |
| Deployment (MVP) | Local only | User's own machine, user's own session |

---

## 8. Evaluation Metrics

| Metric | Definition | Target |
|---|---|---|
| **API-ification rate** | API tool steps / total steps | > 80% (read), > 50% (write) |
| **Task success rate** | End-to-end completion | > 85% |
| **Step reduction** | Steps vs. browser-only for same task | > 60% reduction |
| **Fallback rate** | UI fallback triggers / total calls | < 20% |
| **Self-heal success** | Auto-repairs / total breakages | > 60% (post-MVP) |
| **Unsafe execution rate** | Unapproved write operations | **0** |
| **Pattern reuse rate** | Challenges solved by existing knowledge | Track from site #2 onward |

---

## 9. Open Questions for User Decision

1. **Site curriculum priority:** Which vertical to start with — travel, e-commerce, or information/SaaS? This affects which patterns the knowledge base learns first.

2. **API-key-skill scope:** Should we build a separate skill for auto-registering API keys on services that offer them? Interesting but tangential and ethically murky.

3. **Browser-use dependency:** Depend on browser-use for Phase 1 navigation, or build a minimal custom Playwright wrapper? browser-use is mature (79k stars) but adds a Python dependency; the rest of the stack is Node.js.

4. **mitmproxy2swagger integration:** Use as the clustering engine for Phase 2, or write our own? Handles basic HAR→OpenAPI but lacks causality-aware filtering.

---

## 10. Document Map

| Document | Contents |
|---|---|
| **[architecture-pipeline.md](architecture-pipeline.md)** | Phase 1 (Explore & Record), Phase 2 (Analyze & Extract), Phase 3 (Probe), Phase 4 (Generate & Test), Execution Runtime, Self-Healing |
| **[security-taxonomy.md](security-taxonomy.md)** | 6-layer website security model (reference), Escalation Ladder probing, execution mode derivation, common real-world configurations |
| **[skill-package-format.md](skill-package-format.md)** | Minimal per-website skill directory layout, manifest.json, generated SKILL.md, MCP server runtime |
| **[self-evolution.md](self-evolution.md)** | Hard problems & mitigations, knowledge base structure, evolution loop, knowledge integrity, compounding effect |

---

## 11. References

1. Song, Y., Xu, F., Zhou, S., Neubig, G. (2024). "Beyond Browsing: API-Based Web Agents." arXiv:2410.16464v3. Key finding: Hybrid API+browser agents achieve 38.9% success on WebArena vs 14.8% browser-only.

2. Google Chrome Team. "Built-in AI" initiative and WebMCP proposal for exposing website tools via `navigator.modelContext` API. Status: Early proposal / Origin Trial.

3. mitmproxy2swagger — automatic conversion of intercepted traffic to OpenAPI 3.0 specifications. https://pypi.org/project/mitmproxy2swagger/

4. browser-use — LLM-driven browser automation framework. 79k stars, Playwright-based. https://github.com/browser-use/browser-use

5. Chrome DevTools Protocol. Network domain specification for HTTP traffic monitoring. https://chromedevtools.github.io/devtools-protocol/

6. Anthropic. Model Context Protocol (MCP) — open standard for connecting AI assistants to data sources. https://modelcontextprotocol.io/

7. Microsoft. `@playwright/mcp` — official Playwright MCP server. 1.3M weekly downloads. Browser automation via accessibility snapshots for LLM agents. https://www.npmjs.com/package/@playwright/mcp. Note: Microsoft's own docs state "CLI+SKILLS is better suited for high-throughput coding agents" — validating that generic browser MCP tools bloat context.

8. Google. Chrome DevTools MCP server — browser debugging MCP server. https://github.com/ChromeDevTools/chrome-devtools-mcp

9. W3C. WebDriver BiDi specification (Working Draft, 2026-02-10). https://www.w3.org/TR/webdriver-bidi/
