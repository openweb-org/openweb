# web-skill: Automatic Website-to-API Skill Compiler

## Design Document

**Status:** Draft
**Author:** moonkey
**Date:** 2025-02-26

---

## 1. Problem

Browser-use agents today interact with websites by simulating human behavior: reading DOM / accessibility trees / screenshots, then issuing low-level actions (click, type, scroll, drag). This is fundamentally inefficient:

- **Observation is bloated.** A single webpage's DOM can be thousands of nodes. Accessibility trees are smaller but still noisy. Screenshots require vision models. All of this consumes context window and inference cost for information the agent mostly doesn't need.
- **Actions are fragile.** Click coordinates shift. CSS selectors break. Multi-step form fills require precise sequencing. A single misclick derails the workflow.
- **Latency compounds.** Each tool call renders a page, waits for network, parses state, and decides the next click. A task that a human finishes in 4 clicks may take an agent 15+ tool calls with retries.

Meanwhile, under the hood, every modern web app is an API client. The buttons and forms are just wrappers around `fetch()` / `XMLHttpRequest` calls that send and receive structured JSON. **The actual action space is already structured -- it's just hidden behind the GUI.**

### Evidence

Song et al. (2024), "Beyond Browsing: API-Based Web Agents" (arXiv:2410.16464v3), demonstrated on the WebArena benchmark that:

| Agent Type | Success Rate |
|---|---|
| Browser-only | 14.8% |
| API-only | 29.2% |
| Hybrid (API-first, browser-fallback) | **38.9%** |

The hybrid agent achieved a **24+ percentage point absolute improvement** over browser-only, establishing state-of-the-art among task-agnostic agents. Key insight: when APIs are available, they are strictly superior; combining both modalities is most robust.

However, that paper relied on **manually curated official API documentation** (GitLab REST API, Magento Commerce API, etc.). No one has demonstrated *automatic* extraction of API tool definitions from arbitrary websites that lack public APIs.

That is what this project does.

---

## 2. Vision

**web-skill** is a *website-to-API compiler*. It observes a website's network traffic during human interaction, extracts the underlying API surface, and packages it as a structured skill that any AI agent can call directly -- replacing most click/type GUI operations with typed, schema-validated API calls.

The system has two layers:

1. **`web-use-skill`** (the meta-skill / compiler): A Claude Code skill that, given a target website, drives the full extraction pipeline -- browsing the site, recording traffic, clustering endpoints, inducing schemas, generating tool definitions, building workflows, and producing a tested skill package.

2. **`<site>-web-skill`** (the compiled output): A per-website skill package (e.g., `amazon-web-skill`, `google-flights-web-skill`) containing structured tool definitions, request templates, workflow DAGs, verifiers, and regression tests. An AI agent consuming this package interacts with the website through typed API calls, falling back to browser operations only when necessary.

### Relationship to WebMCP

Google has proposed a standard (informally called "WebMCP") where websites voluntarily expose structured tools via a browser API (`navigator.modelContext.registerTool()`), allowing AI agents to call them directly instead of navigating the DOM.

WebMCP requires developer adoption -- websites must opt in. web-skill is the **client-side complement**: it generates an equivalent tool surface *without* website cooperation, by mining the API that already exists in the network traffic. The two approaches compose naturally:

| Situation | Strategy |
|---|---|
| Website implements WebMCP | Use its native tools (most stable) |
| Website has public API docs | Use official API directly |
| Website has no public API | **web-skill mines it from traffic** |

Short-term, web-skill covers the long tail. Long-term, as WebMCP adoption grows, web-skill becomes a fallback / migration bridge.

---

## 3. System Architecture

```
                    web-use-skill (meta-skill / compiler)
                    ========================================

  Phase 1: EXPLORE       Phase 1.5: PROBE       Phase 2: ANALYZE
  +-----------------+    +------------------+    +------------------+
  | Browse website  |    | Replay endpoints |    | Cluster endpoints|
  | Record traffic  |--->| via direct HTTP  |--->| Diff parameters  |
  | Capture events  |    | Classify exec    |    | Induce schemas   |
  | Map UI flows    |    | mode per endpt   |    | Annotate semantics|
  +-----------------+    +------------------+    +------------------+
          |                       |                       |
          v                       v                       v
    HAR + Event Log         Execution Mode Map      Canonical API Map
    (raw recording)         (empirical, not guessed) (structured model)


  Phase 3: GENERATE       Phase 4: VERIFY & HEAL
  +-------------------+   +-------------------+
  | Synthesize tools  |   | Run test suite    |
  | Build workflows   |   | Detect breakage   |
  | Write tests       |   | Re-record & diff  |
  | Compute fingerprnt|   | Auto-patch skill  |
  +-------------------+   +-------------------+
          |                        |
          v                        v
    <site>-web-skill/        Updated skill +
    (deployable package)     learnings -> meta-skill
                             knowledge base
```

For detailed pipeline documentation, see the documents below.

---

## Document Map

| Document | Contents |
|---|---|
| **[architecture-pipeline.md](architecture-pipeline.md)** | Phase 1 (Explore & Record), Phase 1.5 (Probe summary), Phase 2 (Analyze), Phase 3 (Generate), Phase 4 (Execute & Self-Heal) |
| **[security-taxonomy.md](security-taxonomy.md)** | 6-layer website security model, per-endpoint security profiles, execution mode derivation, probing protocol, real-world configurations |
| **[skill-package-format.md](skill-package-format.md)** | Per-website skill directory layout, manifest.json, generated SKILL.md, meta-skill SKILL.md, MCP server runtime |
| **[self-evolution.md](self-evolution.md)** | Hard problems & mitigations, meta-skill self-evolution (knowledge base, evolution loop, compounding effect) |

---

## 9. MVP Scope & Incremental Strategy

### MVP-1: Read-Only Skill for a Single Site

**Target site:** A search/query-heavy site without a public API (e.g., Google Flights).

**Scope:**
- Recording: Playwright + CDP traffic capture for search flows only
- Clustering: URL-based endpoint grouping for REST-like JSON APIs
- Schema: Auto-inferred JSON Schema for responses
- Tools: `search_flights`, `get_flight_details`, `list_fares`
- Execution: In-browser `fetch()` via Playwright bridge
- Testing: 5 recorded search queries as regression tests

**Not in scope for MVP-1:**
- Write operations (booking, cart)
- Self-healing
- Workflow DAGs
- GraphQL / WebSocket support
- Multi-site skill registry

**Success criteria:** An agent can call `search_flights("SFO", "JFK", "2025-04-01")` and receive accurate, structured flight data -- without any browser click/type operations.

### MVP-2: Add Write Operations & Workflows

- Add cart/checkout tools with human-in-the-loop for payment
- Add workflow DAGs for end-to-end tasks
- Add verifiers for write operations
- Add coupon/promotion detection and application

### MVP-3: Multi-Site & Self-Healing

- Site fingerprinting and change detection
- Automated re-recording and diff-based patching
- Multi-site skill registry in MCP server
- Regression test suite runner

### MVP-4: Second Site (E-Commerce)

- Apply the pipeline to Amazon.com shopping
- Stress-test the clustering and schema induction on a significantly different site architecture
- Validate that the meta-skill generalizes across verticals

---

## 10. Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| Browser automation | Playwright (Node.js) | Best CDP integration, HAR recording built-in, cross-browser |
| Traffic capture | CDP Network domain | Direct access to request/response bodies, initiator stacks, WebSocket frames |
| MCP server | Node.js (stdio transport) | Native Playwright integration, Claude Code MCP support |
| Schema inference | Custom + `json-schema-generator` | Need control over merging multiple samples |
| LLM for analysis | Claude (via Claude Code) | Semantic labeling, tool description generation, PM analysis |
| Test runner | Node.js + custom harness | Replay recorded inputs, assert output schema conformance |
| Skill storage | File system (`.claude/skills/`) | Native Claude Code skill discovery |

---

## 11. Key Design Decisions

### D1: Tiered Execution with Empirical Mode Classification

Execution mode (direct HTTP vs session replay vs headless browser vs UI automation) is **empirically determined per-endpoint** via probing during the build phase, not assumed or statically inferred.

**Rationale:** The observation paradox makes static inference unreliable -- you cannot determine from an all-browser recording which endpoints actually require a browser. Probing (trying without a browser and observing failure) is the only ground truth. The tiered model means we only pay the cost of a browser when the server actually demands it, which for many read operations is never.

**Trade-off:** Probing adds a step to the build pipeline and could theoretically trigger rate limiting or anti-bot alerts. In practice, probing is ~60 requests for a typical site -- well within normal browsing patterns.

### D2: Dual Execution Path (API + UI Fallback)

Every tool definition includes both an API path and a UI fallback.

**Rationale:** No automatic API extraction can guarantee 100% coverage. Some actions may resist API-ification (complex multi-step forms, CAPTCHA flows, iframes). The UI fallback ensures the skill degrades gracefully rather than failing completely.

### D3: Causal Recording (not just HAR)

Standard HAR captures requests but not *why* they were made. C-HAR adds event-to-request causality.

**Rationale:** Without causality, the clustering phase can't distinguish user-triggered API calls from background telemetry, polling, prefetch, and ad requests. This distinction is critical for identifying the "real" API surface.

### D4: LLM-in-the-Loop for Semantic Annotation

We use the LLM not just for generating descriptions but for classifying parameters, naming fields, and composing workflows.

**Rationale:** Heuristic-only approaches (regex for CSRF, entropy for tokens) have limited recall. The LLM can recognize patterns like "this field `pId` in the context of an e-commerce search response is a product identifier" with much higher accuracy.

### D5: Skill as Software Package (not Prompt)

The per-website skill is a directory of structured files (JSON schemas, HTTP templates, JS extractors, YAML workflows), not a monolithic prompt or markdown document.

**Rationale:** Structured packages are diffable, testable, versionable, and partially updatable. A monolithic prompt can't be regression-tested or surgically patched when one endpoint changes.

### D6: Self-Evolving Meta-Skill (Compiler Learns from Its Outputs)

The meta-skill maintains a growing knowledge base (patterns, anti-bot signatures, extractor templates, probe heuristics) that is updated after every per-website-skill build.

**Rationale:** Websites share underlying technology stacks (Next.js, GraphQL, Cloudflare, etc.). A pattern discovered on site #3 applies to site #30. Without evolution, the meta-skill treats every site as novel. With evolution, it accumulates a compounding advantage -- like a compiler's optimization database growing with each new target architecture.

**Trade-off:** The knowledge base must be curated to avoid overfitting to specific sites. Patterns should be generalized (e.g., "Next.js data fetching" not "amazon.com's specific Next.js config") to remain useful across sites.

---

## 12. Open Questions

1. **GraphQL introspection:** When available, should we use GraphQL introspection to bootstrap the schema (much faster and more complete than traffic mining)? This trades stealth for quality -- introspection queries may be logged or disabled.

2. **Rate limiting awareness:** Should tool definitions include rate limit hints (extracted from response headers like `X-RateLimit-Remaining`)? This would let the agent self-throttle.

3. **Multi-tab/multi-page state:** Some sites use multi-tab flows (e.g., popup for OAuth). How should the execution bridge handle this?

4. **Skill sharing & marketplace:** Should per-website skills be shareable? This raises significant legal/ethical questions about distributing extracted API specs for sites that don't publish them.

5. **Cost model:** The meta-skill (extraction pipeline) is expensive (many LLM calls for semantic analysis). Should we cache/share the "canonical API map" separately from the execution-specific skill?

6. **Knowledge base curation:** As the knowledge base grows, how do we prevent overfitting to specific sites? Should there be a "generalization review" step that abstracts site-specific observations into reusable patterns before committing to knowledge/?

7. **Evolution safety:** If the meta-skill updates its own SKILL.md (procedural layer), how do we ensure it doesn't introduce regressions? Should procedural changes require human approval while declarative changes are auto-committed?

8. **Probing side effects:** For write endpoints, probing could have real side effects (creating orders, sending messages). Should the probing phase skip write endpoints entirely and default them to `headless_browser`?

---

## 13. Glossary

| Term | Definition |
|---|---|
| **web-use-skill** | The meta-skill / compiler that generates per-website skills |
| **per-website skill** | A generated skill package for a specific site (e.g., `amazon-web-skill`) |
| **C-HAR** | Causal HAR -- enhanced HTTP Archive format with event-to-request causality links |
| **Tool** | A single structured API operation with typed input/output (e.g., `search_flights`) |
| **Workflow** | A DAG of tools composing a complete user task (e.g., "book cheapest flight") |
| **Bridge** | JavaScript injected into the browser page to execute API calls in-context |
| **Verifier** | Assertion logic that determines if a tool execution succeeded |
| **Fingerprint** | Hash-based version identifier for detecting site changes |
| **Self-heal** | Automated process to detect, diagnose, and repair broken tool definitions |
| **WebMCP** | Google's proposed standard for websites to voluntarily expose AI-callable tools |
| **Probing** | Empirically testing each endpoint across independent security dimensions (auth, CSRF, origin, TLS, bot detection) to determine the minimum required execution context |
| **Observation Paradox** | The inability to infer which execution context factors are necessary from recordings made in a full-context browser |
| **Execution Mode** | One of 6 levels (direct HTTP / session replay / session+CSRF / headless browser / headed browser / headed browser with human) at which a tool can run, derived from its multi-dimensional security profile |
| **Security Profile** | A per-endpoint multi-dimensional classification across 6 security layers (auth, session protection, bot detection, human verification, network controls, request integrity) |
| **Knowledge Base** | The meta-skill's accumulated declarative knowledge (patterns, anti-bot signatures, extractors, probe heuristics) |
| **Procedural Knowledge** | The meta-skill's pipeline algorithm (SKILL.md) -- changes rarely |
| **Declarative Knowledge** | The meta-skill's pattern library (knowledge/) -- grows with each site build |

---

## 14. References

1. Song, Y., Xu, F., Zhou, S., Neubig, G. (2024). "Beyond Browsing: API-Based Web Agents." arXiv:2410.16464v3. Key finding: Hybrid API+browser agents achieve 38.9% success on WebArena vs 14.8% browser-only.

2. Google Chrome Team. "Built-in AI" initiative and WebMCP proposal for exposing website tools via `navigator.modelContext` API. Status: Early proposal / Origin Trial.

3. mitmproxy project. mitmproxy2swagger -- automatic conversion of intercepted traffic to OpenAPI 3.0 specifications. https://mitmproxy.org/

4. Chrome DevTools Protocol. Network domain specification for HTTP traffic monitoring including request/response bodies, initiator stacks, and WebSocket frames. https://chromedevtools.github.io/devtools-protocol/

5. Playwright. Network interception and HAR recording capabilities. https://playwright.dev/docs/network

6. Claude Code Skills documentation. Skill format (SKILL.md + frontmatter), plugin architecture, MCP server integration, subagent execution. https://code.claude.com/docs/en/skills
