# openweb: Website-to-API Compiler — Aligned Design

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
Compiler   = openweb pipeline (this project)
Target     = Per-website skill package (typed tool definitions)
Runtime    = Execution engine (browser session + fallback cascade)
```

A compiler is stateless per-invocation. It evolves its optimization database (knowledge base), not its core passes. This metaphor constrains the architecture correctly.

### 2.2 Relationship to Agent Skills, MCP, CLI, and WebMCP

The AI agent tooling ecosystem is stratifying into layers:

```
Layer 3: Skills (SKILL.md)     — Procedural knowledge, when-to-use triggers
Layer 2: CLI / Tool interfaces — Token-efficient command invocation
Layer 1: MCP / Function calls  — Structured tool schemas (typed I/O)
Layer 0: Raw HTTP / Browser    — Execution substrate
```

As of early 2026:
- The **Agent Skills standard** (agentskills.io) is supported by **30+ agent products** (Claude Code, Cursor, Copilot, Codex, Gemini CLI, etc.).
- **MCP** remains actively versioned (spec update **2025-11-25**) and broadly integrated.
- Microsoft's Playwright team **explicitly recommends CLI+Skills over MCP** for coding agents, citing token efficiency (see Section 2.4).
- **WebMCP** (Google "Built-in AI" initiative) remains in early proposal / Origin Trial.

Therefore the architecture is:
- **CLI-first for agent interaction** — progressive spec navigation + execution via a single thin CLI
- **SKILL.md generated on install** — for agent discovery and ecosystem compatibility
- **MCP as optional adapter** — for agents without shell access
- **WebMCP if a website natively provides tools**

| Situation | Strategy |
|---|---|
| Website implements WebMCP | Use native website tools first |
| Website has public API docs | Use official API directly |
| Website has no public API | **openweb mines traffic, produces tool definitions, serves via CLI (+ optional MCP adapter)** |

See [compiler-output-and-runtime.md](compiler-output-and-runtime.md) for the full design rationale.

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
│  manifest.json + openapi.yaml + tests/*.json      │
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

### D2.1: CLI-first Runtime, MCP-optional Adapter

The primary agent interface is a CLI that provides progressive spec navigation and tool execution. MCP is an optional adapter for agents without shell access.

**Why not MCP-first:** Microsoft's Playwright team (1.3M weekly MCP downloads) explicitly warns that MCP bloats agent context with tool schemas (~4-5K tokens for all tools loaded upfront). Their own recommendation is CLI+Skills. All target agents (Claude Code, Codex, Cursor, Copilot) have shell access. CLI progressive disclosure uses ~400 tokens to discover and use one tool from a 23-tool site vs ~3000-5000 for MCP schema loading.

Implications:
- Canonical compiler output is **OpenAPI 3.1 + `x-openweb` vendor extensions** — standard format, zero custom tooling
- CLI for progressive spec navigation (`openweb <site>`, `openweb <site> <tool>`) and execution (`openweb <site> exec <tool> '{...}'`)
- SKILL.md generated on install to agent workspace (not by compiler)
- LLM tool schemas (OpenAI, Anthropic, MCP, Gemini) mechanically extracted from OpenAPI
- MCP adapter wraps the same executor for non-shell agents
- No forked runtime logic per agent vendor

See [compiler-output-and-runtime.md](compiler-output-and-runtime.md) for the full design.

### D2.2: Compiler-First, Runtime-Thin

The compiler is the product. The runtime is the delivery mechanism.

**Why this matters strategically:**
- Without compiled tools, the runtime is just another `@playwright/mcp` (which has 1.3M weekly downloads — we can't and shouldn't compete).
- With compiled tools, the runtime serves typed, compact API calls that are 10x more efficient than DOM-based browser automation.
- The compiler creates the value; the runtime delivers it. Ship the compiler first.

**Practical implication:** MVP-1 builds the compiler pipeline for one easy site and ships a minimal CLI to serve compiled tools (navigate tool specs, execute requests, verify responses). The CLI is NOT a generic browser-control layer — that already exists.

**Relationship to `@playwright/mcp`:** For `browser_fetch` mode and UI fallback execution, we delegate to Playwright directly rather than building our own browser-control abstraction. Our CLI executor manages tool execution; Playwright manages browser interaction.

### D3: Dual Execution Path (API + UI Fallback)

Every tool has both an API execution path and a UI fallback path. No automatic API extraction can guarantee 100% coverage.

### D4: Standard HAR + UI Action Sidecar

Standard HAR captures *what*. A separate UI action log captures user interactions with timestamps. Causality (which UI action triggered which request) is inferred post-hoc in Phase 2 using temporal proximity and field-name matching — not embedded in the recording format. This replaces the originally proposed C-HAR (Causal HAR) format, which no reference implementation in the industry uses. See [architecture-pipeline.md](architecture-pipeline.md) Phase 1 for details.

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
| Default data capture | Request/response + UI events only. Screenshots/a11y on-demand. |
| Sensitive data | Never store plaintext passwords, payment info, OTP codes. |
| Log sanitization | Auto-redact tokens, cookies, PII in logs and history files. |
| Retention | Raw recordings deleted after skill generation. Only OpenAPI spec + tests retained. |
| Write operation gate | `risk_tier` drives confirmation: `high`/`critical` always confirm, `medium` confirms once per session, `safe`/`low` no confirmation. |
| SSRF protection | Every outbound request validated: hostname, DNS resolution, private IP rejection, metadata endpoint blocking. Applied on all executor fetch() calls including redirects. |
| Site allowlist | Optional site-level allowlist/denylist for enterprise deployments. |

---

## 6. MVP Strategy

### MVP-1: Read-Only Skill for One Simple Site

**Target site: Open-Meteo** (open-meteo.com) — free weather API, clean REST, JSON responses, no auth, no rate limits for reasonable use. Well-documented (can validate compiler output against official docs). Has a real web UI with interactable elements (location search, date pickers, forecast type selectors) that trigger clean REST API calls. Difficulty level 1.

**Scope:**
- Recording: Playwright `record_har` + UI action sidecar for 3-5 read flows
- Clustering: URL-based endpoint grouping with regex normalization
- Schema: quicktype-core for structural inference + LLM for semantic annotation
- Tools: 3-5 read-only tools
- Execution: `direct_http` only (no auth, no session needed)
- SSRF: Mandatory target URL validation on every fetch
- Testing: 5 recorded queries as regression tests
- Filtering: Domain blocklist + content-type filter to remove noise

**Not in scope:**
- Write operations, self-healing, workflows, multi-site
- GraphQL, WebSocket, protobuf
- Session management, auth

**Success criteria:**
An agent can call `search(query)` and receive accurate, structured data — without any browser click/type operations. Quantified comparison: step count, latency, and success rate vs. browser-only agent on the same tasks (at least 20 task replays).

### MVP-2: Add Moderate-Difficulty Site + Write Ops

- Second site with CSRF / cookie auth (escalation to `session_http` / `browser_fetch`)
- Read + limited write operations (add to cart, apply filter)
- Human-in-the-loop for payment
- Real Chrome profile for capture (user's existing session)
- `openweb login <site>` for runtime: visible browser handoff → cookie capture → plaintext cookie jar
- Risk classification (deterministic rule-based)
- Endpoint identity tracking (stable_id, signature_id, tool_version)
- GraphQL support
- Basic fingerprint-based change detection

### MVP-3: Google Flights + Self-Healing + Auth Hardening

- Hard site: protobuf, TLS fingerprint, complex session
- Self-healing pipeline (detect breakage → re-record → diff → patch)
- Encrypted auth store (AES-256-GCM, machine-ID keyed, subdomain fallback)
- JWT `exp` parsing for proactive refresh
- Knowledge base accumulation from 3+ sites

### MVP-4: Scale & Generalize

- 10+ sites across verticals
- Knowledge base proves compounding value
- MCP adapter for non-shell agents (optional)

### 90-Day Execution Plan

| Phase | Weeks | Focus | Exit Criteria |
|---|---|---|---|
| **A: Compiler MVP** | 1–3 | Record (HAR + UI action sidecar) + cluster (regex normalization + quicktype) + emit tools for Open-Meteo. Ship thin CLI (spec navigator + executor). Benchmark harness. | 3–5 read-only tools. Agent completes 20 tasks via CLI. Baseline metrics: success rate, latency, step count vs browser-only. |
| **B: Second Site + Write Ops** | 4–7 | Second site (moderate difficulty: CSRF/cookies). Write operations. Escalation ladder probing. Begin knowledge base. | 2 sites compiled, each ≥3 tools. Compiled tools beat browser-only on ≥2 of 3 metrics. |
| **C: Hardening + Third Site** | 8–12 | Third+ sites. Self-healing. Regression suite. Change gating. OpenAPI export. Optional MCP adapter. | 5–10-site batch. No critical regressions. Knowledge base shows measurable pattern reuse. |

**Why compiler-first (with runtime-thin):** A generic browser-control MCP server is `@playwright/mcp` (1.3M weekly downloads). We don't build what already exists. Our unique value—the compiler—ships first. The CLI serving layer for compiled tools is thin and ships alongside it.

---

## 7. Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| Browser automation | Playwright (Node.js) | Best CDP integration, cross-browser |
| Navigation agent | Custom Node.js (Playwright + LLM, ~200-300 lines) | Minimal agent that reads a11y tree, exercises UI. Avoids Python dependency (browser-use). Replaceable with more capable agent later. |
| Default browser mode | Real Chrome profile (`channel: "chrome"`) | Sidesteps bot detection for authenticated sites. Clean Chromium for public sites. |
| Traffic capture | Playwright `record_har` + CDP | Standard HAR output, zero custom recording code |
| Traffic filtering | Domain blocklist + content-type + path noise | 40+ blocked domains, reduces Phase 2 noise by 60-80% |
| Clustering | Node.js reimplementation (~300-500 lines) | Straightforward URL parsing and grouping. mitmproxy2swagger used as benchmark, not dependency. |
| CLI (spec navigator + executor) | Node.js | Native Playwright integration, single-language stack |
| CLI executor architecture | Hybrid: per-invocation CLI + background browser daemon | Stateless CLI for simplicity; daemon for warm browser sessions. Auto-start/auto-exit. |
| MCP adapter (optional) | Node.js (stdio transport) | Thin wrapper over CLI executor for non-shell agents |
| SKILL.md generation | Template-based generator | Emits Agent Skills standard format on `openweb install` |
| Schema inference | `quicktype-core` (TypeScript library) | Multi-sample aggregation, union types, array item inference. LLM only for semantic annotation layer. |
| URL normalization | Regex-based (5 patterns: UUID, numeric, hex, base64, date) | Sufficient — no reference project uses LLM for clustering |
| Dependency graph | Structural field-name matching | Exact match (0.9) + suffix match (0.6), filter generics, O(n²) |
| LLM for analysis | Claude (via API) | Semantic labeling, tool descriptions, parameter classification. ~$0.50-$2.00 per 10-endpoint site with Haiku. |
| Test runner | Node.js custom harness | Replay inputs, assert schema conformance |
| SSRF protection | Mandatory on every fetch() | Hostname validation, DNS resolution, private IP rejection, metadata endpoint blocking |
| Skill storage | File system | Simple, versionable, portable |
| State storage (MVP) | File system | Session cookies, probe results, knowledge base |
| Auth storage (MVP-2) | Plaintext cookie jar (`~/.openweb/sessions/`) | Upgrade to encrypted store in MVP-3 |
| Auth storage (MVP-3) | AES-256-GCM encrypted, machine-ID keyed | `0o600` permissions, subdomain fallback |
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

## 9. Resolved Questions

1. **Site curriculum priority:** Start with weather/information vertical (Open-Meteo for MVP-1). Second site: moderate-difficulty e-commerce or SaaS with CSRF/cookies. This builds the knowledge base progressively.

2. **API-key-skill scope:** Deferred. Tangential to core value and ethically murky. Focus on traffic-based extraction.

3. **Browser-use dependency:** **Resolved: custom Node.js navigation agent.** For Phase 1, the navigation agent doesn't need browser-use's full sophistication — it needs to read the a11y tree, identify interactable elements, and exercise them. This is ~200-300 lines of Playwright + LLM code. Keeps the stack uniform (no Python dependency). Upgrade to a more capable agent later if needed. browser-use can be used as a subprocess if the custom agent proves insufficient.

4. **mitmproxy2swagger integration:** **Resolved: don't integrate directly.** Reimplement clustering logic in Node.js (~300-500 lines) — straightforward URL parsing and grouping. Evaluate mitmproxy2swagger's output on test data as a benchmark. Our additions (causal filtering, parameter classification, semantic annotation, dependency graph) are the majority of Phase 2 anyway.

---

## 10. Document Map

| Document | Contents |
|---|---|
| **[architecture-pipeline.md](architecture-pipeline.md)** | Phase 1 (Explore & Record), Phase 2 (Analyze & Extract), Phase 3 (Probe), Phase 4 (Generate & Test), Execution Runtime, Self-Healing |
| **[compiler-output-and-runtime.md](compiler-output-and-runtime.md)** | First-principles derivation of compiler output format, OpenAPI 3.1 + x-openweb extensions as canonical format, CLI design (progressive navigation + executor), derived formats, SKILL.md generation |
| **[security-taxonomy.md](security-taxonomy.md)** | 6-layer website security model (reference), Escalation Ladder probing, execution mode derivation, common real-world configurations |
| **[skill-package-format.md](skill-package-format.md)** | Per-website skill package directory layout, manifest.json, OpenAPI spec format, test format |
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
