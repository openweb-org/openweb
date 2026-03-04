# openweb MVP-1 Final Design (Codex-first Aligned Draft)

> Status: Alignment draft for Claude + Codex
> Date: 2026-03-04
> Principle: KISS + First-Principles
> Target: Prove value, not breadth

---

## 0. One-Sentence Goal

Given recorded web traffic, automatically produce typed API tools so an agent can complete web tasks faster, cheaper, and more reliably than browser-click automation.

---

## 1. What MVP-1 Must Prove

MVP-1 is successful only if all three hold:

1. Compiler proof: one real website can be compiled into stable, callable tools.
2. Runtime proof: agents can discover and execute those tools through a low-token CLI flow.
3. Outcome proof: compiled tools beat browser-only execution on step count, latency, and task success.

Primary validation set: 20 weather tasks on Open-Meteo.

---

## 2. Alignment Decisions (Resolved)

| Topic | Final Decision | Why |
|---|---|---|
| Target site | Open-Meteo | Lowest complexity, real UI, real APIs, no auth |
| Recording mode | Manual interactive recording | Fastest path to prove compiler pipeline |
| Execution mode in MVP-1 | `direct_http` only | Site is public read-only; avoids premature runtime complexity |
| Phase 3 probing | Collapse to direct replay verification only | Keep empirical check without full escalation ladder |
| Output format | OpenAPI 3.1 + `x-openweb` | Standard + minimal runtime metadata |
| CLI vs MCP | CLI-first, no MCP in MVP-1 | Lowest token overhead and implementation cost |
| Session/auth | Out of scope | Not required for Open-Meteo |
| Self-healing | Out of scope (manual rerun only) | Not needed for one-site proof |
| Risk handling | Emit `risk_tier` as `safe` by default, no runtime gating | Keep schema forward-compatible with minimal logic |
| SKILL.md | Hand-written for MVP-1 (optional), generator deferred | Reduces implementation surface |

---

## 3. Scope

### 3.1 In Scope

- Compile one site: Open-Meteo.
- Read-only operations (3-5 tools expected).
- Recording artifacts: HAR + UI action sidecar.
- Filtering + clustering + parameter differentiation + schema induction.
- Optional LLM semantic annotation for naming/descriptions.
- Generate package: `manifest.json`, `openapi.yaml`, `tests/`.
- CLI navigator + executor.
- Structured error contract.
- SSRF protection on all runtime requests.
- Benchmark harness with browser-only baseline.

### 3.2 Out of Scope

- Auth/session lifecycle (`openweb login`, cookie store, encryption).
- Write operations and confirmation policy.
- Full escalation ladder (`session_http`, `browser_fetch`) implementation.
- GraphQL/WebSocket/protobuf.
- Self-healing automation and knowledge base evolution.
- MCP adapter and distribution workflow.

---

## 4. Minimal Architecture

```text
[Compiler]
  Record -> Analyze -> Generate
                 |
                 v
      [Skill Package (per site)]
   manifest.json + openapi.yaml + tests/
                 |
                 v
           [CLI Runtime]
       Navigator + direct_http Executor
```

Design boundary:
- Compiler can be expensive and slower.
- Runtime must be stateless, simple, fast.

---

## 5. Data Contracts

### 5.1 Recording Output

```text
recording/
├── traffic.har
├── ui_actions.jsonl
└── metadata.json
```

`ui_actions.jsonl` minimal fields:
- `timestamp_ms`
- `action`
- `selector` (nullable)
- `value` (nullable)
- `url`

### 5.2 Skill Package Output

```text
~/.openweb/sites/open-meteo/
├── manifest.json
├── openapi.yaml
└── tests/
```

### 5.3 `x-openweb` (Operation-level, MVP-1 subset)

Required:
- `mode` (always `direct_http` in MVP-1)

Included for forward compatibility:
- `risk_tier` (default `safe`)
- `verified` (direct replay passed)
- `stable_id`
- `signature_id`
- `tool_version`

### 5.4 Test Case Shape

Each tool has `tests/<operation>.test.json`:
- `operation_id`
- `cases[]`
- per case: `input`, `assertions.status`, `assertions.response_schema_valid`
- optional: `response_contains` structural checks

Rule: assert schema conformance, not exact values.

### 5.5 Error Contract

On failure: stderr JSON + exit code 1.

```json
{
  "error": "execution_failed",
  "code": "INVALID_PARAMS",
  "message": "Missing required parameter: latitude",
  "action": "Run `openweb open-meteo get_forecast` to inspect parameters.",
  "retriable": false
}
```

MVP-1 codes:
- `EXECUTION_FAILED`
- `TOOL_NOT_FOUND`
- `INVALID_PARAMS`

---

## 6. Compiler Pipeline (MVP-1)

## 6.1 Phase 1: Record (Interactive)

Command:

```bash
openweb compile https://open-meteo.com --interactive
```

Flow:
1. Launch headed browser with HAR capture.
2. User performs 3-6 flows with 2-3 input variations each.
3. Close browser to end recording.

Capture-time filtering:
- Domain blocklist for analytics/ads/telemetry.
- Content-type allowlist for JSON/form API traffic.

## 6.2 Phase 2: Analyze

Step A: Cluster
- Keep 2xx candidates.
- Normalize URL segments by regex (UUID/number/hash/base64/date).
- Group by `method + host + normalized_path + query-key-set`.

Step B: Differentiate parameters
- Detect constant vs varying vs optional values across samples.

Step C: Infer schema
- Use `quicktype-core` on multi-sample responses.

Step D: Semantic annotation (optional but recommended)
- LLM assigns operation names and concise descriptions.
- Fallback: mechanical names if LLM unavailable.

## 6.3 Phase 3: Verify (MVP-1 reduced)

Not full probing.

For each generated GET tool:
- Execute direct replay once.
- Mark `verified=true` on success.
- Keep `mode=direct_http`.

## 6.4 Phase 4: Generate

Emit:
- `openapi.yaml` (canonical)
- `manifest.json` (site metadata + minimal dependencies)
- `tests/*.test.json`

Run smoke tests for all generated tools.

---

## 7. Runtime CLI (MVP-1)

### 7.1 Navigator Commands

```bash
openweb sites
openweb open-meteo
openweb open-meteo get_forecast
openweb open-meteo get_forecast --full
```

### 7.2 Executor Command

```bash
openweb open-meteo exec get_forecast '{"latitude":52.52,"longitude":13.41,"hourly":["temperature_2m"]}'
```

Execution path:
1. Load OpenAPI operation.
2. Validate params.
3. Build request URL/query.
4. Run SSRF validation.
5. Execute HTTP request.
6. Validate response schema.
7. Print JSON to stdout.

### 7.3 SSRF Rules (Mandatory)

For every outbound request (including redirects):
- require `https` (except explicit local dev allowlist)
- DNS resolve hostname
- block private IP ranges
- block metadata targets (`169.254.169.254`)

---

## 8. Open-Meteo Tool Targets

Expected tool set (3-5):
- `search_location` (`geocoding-api.open-meteo.com/v1/search`)
- `get_forecast` (`api.open-meteo.com/v1/forecast`)
- `get_historical` (`api.open-meteo.com/v1/archive`)
- `get_air_quality` (`api.open-meteo.com/v1/air-quality`)

Important MVP check:
- At least one multi-domain operation uses per-operation `servers` override in OpenAPI.

---

## 9. Delivery Plan (3 Weeks)

### Week 1: Runtime First

- Scaffold CLI project.
- Hand-write Open-Meteo OpenAPI fixture.
- Implement navigator + direct executor + error contract + SSRF.
- Exit: agent can call fixture tools end-to-end.

### Week 2: Compiler

- Implement recorder/filter/cluster/diff/schema/annotation/generator.
- Generate spec from real recording.
- Compare generated spec behavior with hand-written fixture.
- Exit: generated tools run successfully.

### Week 3: Benchmark + Stabilize

- Build 20-task benchmark harness.
- Build browser-only baseline.
- Collect metrics and iterate on bugs/usability.
- Exit: quantified proof report produced.

---

## 10. Success Metrics

| Metric | Target |
|---|---|
| Working tools | 3-5 read-only tools |
| Task success rate | >= 85% on 20 tasks |
| Step reduction | >= 60% vs browser-only |
| Avg task latency | < 2s |
| Compile LLM cost | < $1 per site |
| Schema validity | 100% tests pass for generated cases |

---

## 11. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Bad clustering | multi-variation recording + fixture parity test |
| Weak naming quality | LLM fallback to deterministic operation IDs |
| Noise in recordings | capture-time + analysis-time filtering |
| Benchmark bias | diverse task set, include multi-step geocode->forecast flows |
| Site drift during build | keep smoke tests and allow quick recompile |

---

## 12. Post-MVP-1 Roadmap Boundary

MVP-1.5:
- agent-driven exploration
- SKILL.md generation command

MVP-2:
- second site with auth
- full probing ladder (`direct_http -> session_http -> browser_fetch`)
- write operations + risk gating
- session manager and `openweb login`

MVP-3:
- hard site (anti-bot/signing/protobuf)
- passive self-healing and encrypted auth store
- knowledge accumulation loop

---

## 13. First-Principles Sanity Check

If this design fails, it should fail quickly and clearly:
- If generated tools are not better than browser automation on Open-Meteo, the core thesis is weak.
- If they are better, the architecture is validated and complexity can be added incrementally.

This is why MVP-1 stays intentionally narrow.
