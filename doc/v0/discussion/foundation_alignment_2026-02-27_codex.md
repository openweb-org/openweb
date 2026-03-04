# Foundation Alignment (Claude First, Codex Response)

Date: 2026-02-27
Mission anchor: make any agent access the web easily, fast, and cheap.

## 0) Skill Note
`align` / `ultra-think` are not available skills in this workspace session. We executed the same intent manually: full-doc review + external evidence + explicit design debate + convergence decisions.

## 1) Source Grounding
We aligned using:
- `doc/mission.md`
- `doc/initial_design/*.md`
- `doc/design_review_claude/*.md`
- `doc/design_review_codex/*.md`

External primary sources used:
- MCP spec/docs and client support matrix: [modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2025-06-18), [clients](https://modelcontextprotocol.io/clients), [spec repo](https://github.com/modelcontextprotocol/specification)
- Chrome DevTools MCP server (official): [blog](https://developer.chrome.com/blog/chrome-devtools-mcp), [repo](https://github.com/ChromeDevTools/chrome-devtools-mcp)
- Playwright network/limitations/tracing: [network](https://playwright.dev/docs/network), [service workers](https://playwright.dev/docs/next/service-workers), [trace viewer](https://playwright.dev/docs/trace-viewer)
- CDP Network domain (initiator/body capture): [CDP Network](https://chromedevtools.github.io/devtools-protocol/1-3/Network)
- WebDriver BiDi status (W3C WD 2026-02-10): [spec](https://www.w3.org/TR/webdriver-bidi/)
- OpenAPI latest + registry + MCP bridge: [OpenAPI versions](https://spec.openapis.org/oas/latest.html), [OpenAPI Registry entry](https://registry.modelcontextprotocol.io/integrations/openapi), [mcp-openapi](https://github.com/snaggle-ai/openapi-mcp-server)
- browser-use MCP page: [docs](https://docs.browser-use.com/customize/mcp)
- traffic->OpenAPI prior art: [mitmproxy2swagger](https://github.com/alufers/mitmproxy2swagger)

## 2) Debate (Claude Starts First)

### Round 1: What is the real product?
Claude:
- The current design risks over-building a "website compiler platform" before proving user value.
- First principles: users want web tasks done, not architecture purity.

Codex:
- Agree on risk, but mission requires "any agent" interoperability, not only one runtime.
- Therefore the true product is a **standardized web access layer**, with compiler as an optimizer.

Convergence:
- Product split into two layers:
  - Layer A (mandatory): **Universal Web Access Runtime** (MCP-first, agent-agnostic).
  - Layer B (optional): **Per-site API compiler** to accelerate high-value sites.
- Do not block Layer A on Layer B completeness.

### Round 2: Execution mode complexity
Claude:
- 6-mode taxonomy is over-granular for runtime decisions.
- Use an escalation ladder, stop at first success.

Codex:
- Keep rich taxonomy for offline diagnostics/learning, not hot-path execution.
- Runtime should only need minimal, stable mode labels.

Convergence:
- Runtime canonical modes (v1):
  1. `direct_http`
  2. `session_http` (cookies + optional csrf/origin handling)
  3. `browser_fetch` (in-page fetch via browser context)
- `human_handoff` is a flag, not a separate mode.
- Probing algorithm: cheap-to-expensive ladder with early stop.

### Round 3: Package and DSL design
Claude:
- Current package structure and workflow DSL are premature.
- Too many directories, duplicated truths, maintenance burden.

Codex:
- Strongly agree. One source of truth is required for reliability and cross-agent portability.
- Prefer schema-first tool specs and no custom workflow language in v1.

Convergence:
- `tools/*.json` is canonical source.
- No workflow DSL in v1; planner uses tool descriptions + dependency hints.
- Keep package minimal; add optional directories only when proven necessary.

### Round 4: Self-evolution safety
Claude:
- Self-evolution without conflict resolution and regression gating is unsafe.

Codex:
- Procedural rules must be human-governed; declarative stats can auto-append.
- Need TTL, confidence, rollback policy.

Convergence:
- Two-lane evolution:
  - Auto lane: observations, metrics, logs.
  - Guarded lane: patterns/rules/procedures require review + regression.
- No auto-publish for write-path changes.

### Round 5: Standards and ecosystem leverage
Claude:
- Use existing standards aggressively; do not invent new protocol unless unavoidable.

Codex:
- MCP is now concrete and cross-client but feature support varies by client.
- OpenAPI can be interchange layer; MCP adapters already exist.
- Chrome DevTools MCP and Playwright/CDP are practical runtime primitives today.

Convergence:
- Interop strategy:
  - External interface: MCP tools.
  - Tool schema interchange: OpenAPI/JSON Schema compatible.
  - Browser instrumentation: Playwright + CDP now, keep BiDi-compatible abstraction.

## 3) Final Direction (Single Decision)

**Decision:** Build `web-access-mcp` first (agent-agnostic runtime), and treat `web-compiler` as optional acceleration for selected sites.

Why this is first-principles correct:
- "Any agent" requires protocol-level compatibility before site-level intelligence.
- Runtime utility is immediate even without perfect API extraction.
- Compiler value compounds later once runtime and eval loop are stable.

## 4) Minimal Architecture (KISS)

## 4.1 Runtime (`web-access-mcp`)
Expose small, stable tool surface:
- `open_page(url)`
- `act(action)` (click/type/select/submit with explicit target)
- `observe()` (dom summary + url + title + key state)
- `network_start()` / `network_stop()`
- `http_call(request)`
- `browser_call(request_template, args)` (in-page fetch)
- `get_artifact(id)` (trace/har/chunks)

Notes:
- Keep tool count low and composable.
- Avoid agent-specific prompt contracts in runtime.

## 4.2 Compiler (`web-compiler`, optional)
Pipeline v1:
1. Record read-only flows.
2. Cluster endpoints.
3. Emit `tools/*.json`.
4. Validate replay.

Out of v1:
- workflow DSL
- auto self-heal publish
- write probing with side effects

## 4.3 Data contracts
- Canonical: `tools/*.json`
- Optional derived: human-readable `SKILL.md`, reports
- Runtime mode per tool:
  - `mode`: one of `direct_http|session_http|browser_fetch`
  - `human_handoff`: boolean
  - `confidence`: 0..1

## 5) What We Explicitly Avoid (for now)
- No 6-mode runtime state machine.
- No mandatory per-site giant package structure.
- No custom workflow DSL engine.
- No procedural self-modification without review.
- No marketplace/distribution architecture work in foundation phase.

## 6) Evidence-backed Design Constraints
- MCP is real and widely integrated, but client feature support differs; design for least-common-denominator tools first.
- Chrome DevTools MCP gives immediate browser introspection/control path without inventing protocol.
- Playwright network capture has service-worker caveats; recording pipeline must include SW handling strategy.
- CDP can capture `requestWillBeSent` + `initiator` and body retrieval; sufficient for causal mapping start.
- WebDriver BiDi is advancing; keep runtime adapter boundary so CDP is not hard-coded forever.
- OpenAPI 3.2 exists and MCP OpenAPI adapters exist; use OpenAPI as interchange target to avoid lock-in.

## 7) 90-Day Execution Plan

### Phase A (Weeks 1-3): Runtime first
- Ship `web-access-mcp` with minimal tool set.
- Integrate one agent end-to-end (Claude Code) + one non-Claude client path.
- Deliver benchmark harness (same tasks, same environment).

Exit criteria:
- 20 scripted tasks, reproducible runs.
- Baseline metrics collected: task success, median latency, tool calls, token usage.

### Phase B (Weeks 4-7): Read-only compiler MVP
- Add recorder + endpoint clustering + tool emission.
- Support JSON REST first; no GraphQL/WS.
- Add ladder probing (3 modes only).

Exit criteria:
- 3 sites compiled, each with >=3 useful tools.
- Compiled tools beat browser-only baseline on at least 2 of 3 metrics (latency/cost/tool-calls).

### Phase C (Weeks 8-12): Hardening
- Add regression suite and change gating.
- Add guarded knowledge updates (no procedural auto-change).
- Start second agent integration path.

Exit criteria:
- 10-site batch run.
- No critical regressions on prior compiled tools.

## 8) Decision Log (Locked)
1. `MCP-first` interface: LOCKED.
2. Runtime 3 modes + `human_handoff` flag: LOCKED.
3. `tools/*.json` as single source of truth: LOCKED.
4. No workflow DSL in foundation phase: LOCKED.
5. Compiler optional, runtime mandatory: LOCKED.
6. Guarded evolution for procedural changes: LOCKED.

## 9) Open Items (Not Blocking)
- GraphQL introspection policy by site category.
- Multi-tab auth popup handling abstraction.
- Write-operation safe validation strategy.
- Compliance policy profile templates by deployment type.

## 10) Addendum: Skills vs MCP (2026-02-27)

After explicit re-check:
- Agent Skills has become an open, cross-platform standard (Anthropic announced Skills on 2025-10-16 and open standard update on 2025-12-18).
- MCP remains the de facto execution protocol backbone and continues active spec evolution.

Aligned stance (locked):
1. MCP is the runtime and interoperability substrate.
2. Skills are distribution/orchestration wrappers on top of MCP.
3. Do not fork runtime per agent vendor; generate wrappers from one canonical tool spec.
