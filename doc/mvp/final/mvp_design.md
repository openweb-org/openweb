# openweb MVP-1 Final Design

> Status: **ALIGNED** (Codex APPROVE + Claude APPROVE)
> Date: 2026-03-04
> Principle: KISS + First-Principles
> Target: Prove value, not breadth
> Revision: R2 (Claude additions: tech stack, project structure, code sketches, examples)

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
| Recording mode | Scripted Playwright (primary) + manual interactive (fallback) | Scripted: reproducible, headless, no human needed. Enables autonomous dev/verify. |
| Execution mode in MVP-1 | `direct_http` only | Site is public read-only; avoids premature runtime complexity |
| Phase 3 probing | Collapse to direct replay verification only | Keep empirical check without full escalation ladder |
| Output format | OpenAPI 3.1 + `x-openweb` | Standard + minimal runtime metadata |
| CLI vs MCP | CLI-first, no MCP in MVP-1 | Lowest token overhead and implementation cost |
| Session/auth | Out of scope | Not required for Open-Meteo |
| Self-healing | Out of scope (manual rerun only) | Not needed for one-site proof |
| Risk handling | Emit `risk_tier` as `safe` by default, no runtime gating | Keep schema forward-compatible with minimal logic |
| `openweb test` | In scope for Week 3, not optional | Validates compiler output; ~50 lines reusing executor |
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

## 4A. Tech Stack

| Component | Choice | Why |
|---|---|---|
| Language | TypeScript | Playwright is Node-native, quicktype is TS, single-language stack |
| Browser automation | Playwright | Best CDP integration, built-in `record_har` |
| Schema inference | `quicktype-core` | Multi-sample aggregation, union types, battle-tested |
| CLI framework | `yargs` | Minimal, sufficient, well-documented |
| LLM | Claude Haiku via `@anthropic-ai/sdk` | Cheapest, fast, good enough for naming |
| HTTP client | Node native `fetch` | Zero deps for executor |
| Build | `tsup` | Fast TS bundling |
| Package manager | `pnpm` | Fast, disk-efficient |
| Testing | `vitest` | Fast, TS-native |

## 4B. Project Structure

```
src/
  cli.ts                        # yargs entry point
  commands/
    compile.ts                  # openweb compile <url>
    exec.ts                     # openweb <site> exec <tool> '{...}'
    sites.ts                    # openweb sites
    show.ts                     # openweb <site> [<tool>]
    test.ts                     # openweb <site> test
  compiler/
    recorder.ts                 # Phase 1: Playwright record_har + UI action capture
    analyzer/
      filter.ts                 # Domain blocklist + content-type + path noise
      cluster.ts                # URL normalization + grouping
      differentiate.ts          # Parameter classification (constant/variable/optional)
      schema.ts                 # quicktype-core wrapper
      annotate.ts               # LLM naming + descriptions
    generator.ts                # Phase 4: emit openapi.yaml + manifest.json + tests/
  runtime/
    executor.ts                 # direct_http: build URL → SSRF check → fetch → validate
    navigator.ts                # Format OpenAPI for progressive CLI display
  lib/
    ssrf.ts                     # URL validation (private IP, metadata endpoint)
    openapi.ts                  # OpenAPI spec read/write utilities
    errors.ts                   # Structured error types + stderr writer
    filtering.ts                # Domain blocklist data
scripts/
  record_open_meteo.ts          # Scripted Playwright recorder for Open-Meteo (test infra)
```

~15 files. Each file has one job. No file should exceed ~300 lines.

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

Expected `openapi.yaml` structure (abbreviated):

```yaml
openapi: "3.1.0"
info:
  title: Open-Meteo
  version: "1.0.0"
  x-openweb:
    spec_version: "0.1.0"
    generated_at: "2026-03-10T12:00:00Z"
    requires_auth: false

servers:
  - url: https://api.open-meteo.com

paths:
  /v1/forecast:
    get:
      operationId: get_forecast
      summary: Get hourly and daily weather forecast for a location
      x-openweb:
        mode: direct_http
        risk_tier: safe
        human_handoff: false
        verified: true
      parameters:
        - name: latitude
          in: query
          required: true
          schema: { type: number }
          description: "Latitude in decimal degrees (e.g., 52.52)"
        - name: longitude
          in: query
          required: true
          schema: { type: number }
          description: "Longitude in decimal degrees (e.g., 13.41)"
        - name: hourly
          in: query
          schema:
            type: array
            items: { type: string }
          description: "Hourly weather variables (temperature_2m, precipitation, ...)"
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  latitude: { type: number }
                  longitude: { type: number }
                  hourly: { type: object }

  /v1/search:
    get:
      operationId: search_location
      summary: Search for a location by name (geocoding)
      servers:
        - url: https://geocoding-api.open-meteo.com   # per-operation override
      # ...
```

Note: `search_location` uses a per-operation `servers` override for `geocoding-api.open-meteo.com`. This exercises multi-domain handling even in MVP.

Expected `manifest.json`:

```json
{
  "name": "open-meteo",
  "version": "1.0.0",
  "spec_version": "0.1.0",
  "site": "open-meteo.com",
  "generated_at": "2026-03-10T12:00:00Z",
  "requires_auth": false,
  "dependencies": {
    "search_location.results[].latitude": "get_forecast.latitude",
    "search_location.results[].longitude": "get_forecast.longitude"
  }
}
```

### 5.3 `x-openweb` (Operation-level, MVP-1 subset)

Required:
- `mode` (always `direct_http` in MVP-1)

Included for forward compatibility:
- `risk_tier` (default `safe`, no runtime gating in MVP-1)
- `human_handoff` (always `false` in MVP-1)
- `verified` (direct replay passed)
- `stable_id`
- `signature_id`
- `tool_version`

Concrete example:

```yaml
x-openweb:
  mode: direct_http
  risk_tier: safe
  human_handoff: false
  verified: true
  stable_id: "a1b2c3d4e5f6g7h8"
  signature_id: "i9j0k1l2m3n4o5p6"
  tool_version: 1
```

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
- `EXECUTION_FAILED` — HTTP request failed (includes status code in message)
- `TOOL_NOT_FOUND` — Unknown site or operation
- `INVALID_PARAMS` — Parameters don't match schema

The `action` field gives agents a concrete next step. Always present.

---

## 6. Compiler Pipeline (MVP-1)

## 6.1 Phase 1: Record

Three recording modes, same output format:

**Mode A: Scripted recording** (`openweb compile <url> --script <file>`)
A deterministic Playwright script that programmatically navigates the site, interacts with UI elements, and generates parameter variance. No LLM, no GUI needed — runs headless. This is the primary mode for MVP-1 development and CI, since it enables fully autonomous implement/verify without human intervention.

```bash
openweb compile https://open-meteo.com --script scripts/record_open_meteo.ts
```

**Mode B: Interactive recording** (`openweb compile <url> --interactive`)
Launch a headed browser for a human to browse manually. For end-user workflows or sites where scripted selectors aren't yet written.

**Mode C: Agent-driven exploration** (MVP-1.5, not in scope)
LLM reads a11y tree, drives browser autonomously. Deferred.

All three modes produce identical output:

```
recording/
├── traffic.har
├── ui_actions.jsonl
└── metadata.json
```

The scripted recorder for Open-Meteo (`scripts/record_open_meteo.ts`) exercises:
- 3+ cities (Berlin, Tokyo, New York) × forecast, historical, air quality
- Different weather variables per request
- Geocoding search with varied queries
- Target: ~18 flows generating 2-3 samples per endpoint group

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

Not full probing — no escalation ladder, no auth detection, no CSRF testing.

For each generated GET tool:
- Execute one direct HTTP replay with recorded parameters.
- Check: HTTP 200 + response passes schema validation.
- Mark `verified=true` on success.
- Keep `mode=direct_http` (hardcoded for MVP-1).
- On failure: `verified=false`, log warning, still emit the tool. The user decides.

This is ~20 lines of code. It reuses the executor's `fetch()` path.

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

Progressive disclosure — example output:

```
$ openweb open-meteo
search_location       Search for a location by name (geocoding)
get_forecast          Get hourly and daily weather forecast for a location
get_historical        Get historical weather data for a location
get_air_quality       Get air quality data for a location

$ openweb open-meteo get_forecast
GET /v1/forecast
  latitude:   number    Latitude in decimal degrees (e.g., 52.52)      [required]
  longitude:  number    Longitude in decimal degrees (e.g., 13.41)     [required]
  hourly:     string[]  Hourly variables (temperature_2m, precipitation, ...)
  daily:      string[]  Daily variables (temperature_2m_max, precipitation_sum, ...)
  timezone:   string    Timezone (e.g., Europe/Berlin)
Returns: { latitude, longitude, hourly: { time[], temperature_2m[], ... } }
Mode: direct_http
```

~150 tokens per tool view vs ~3000-5000 for loading all MCP tools. This 10-20x token reduction is a key advantage of CLI progressive disclosure.

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
6. Validate response schema (warn on mismatch, don't fail).
7. Print JSON to stdout.

Code sketch (~50 lines):

```typescript
async function execute(site: string, tool: string, params: Record<string, any>) {
  const spec = loadOpenAPI(site);
  const op = findOperation(spec, tool);
  const serverUrl = getServerUrl(spec, op);  // handles per-operation servers override
  const url = buildQueryUrl(serverUrl, op.path, op.parameters, params);

  await validateSSRF(url);  // MANDATORY

  const res = await fetch(url, {
    method: op.method.toUpperCase(),
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    writeErrorToStderr({
      code: 'EXECUTION_FAILED',
      message: `HTTP ${res.status}`,
      action: `Check parameters with: openweb ${site} ${tool}`,
      retriable: res.status === 429,
    });
    process.exit(1);
  }

  const json = await res.json();
  process.stdout.write(JSON.stringify(json));
}
```

No browser. No session. No daemon. URL construction + fetch.

### 7.3 SSRF Rules (Mandatory)

For every outbound request (including redirects):
- require `https` (except explicit local dev allowlist)
- DNS resolve hostname
- block private IP ranges
- block metadata targets (`169.254.169.254`)

Code sketch:

```typescript
async function validateSSRF(urlString: string): Promise<void> {
  const url = new URL(urlString);
  if (url.protocol !== 'https:') throw new Error('HTTPS required');

  const ips = await dns.resolve4(url.hostname);
  for (const ip of ips) {
    if (isPrivateIP(ip)) throw new Error(`Private IP blocked: ${ip}`);
  }
  if (url.hostname === '169.254.169.254') throw new Error('Metadata endpoint blocked');
}
```

This is ~15 lines and non-negotiable. The executor takes user-provided params and constructs HTTP requests — SSRF is a real attack vector.

### 7.4 Test Command (Week 3)

```bash
openweb open-meteo test
```

Runs all `tests/*.test.json` for a site: execute each case, check assertions, report pass/fail. This is the regression testing mechanism that validates compiler output. ~50 lines using the executor's existing fetch path.

---

## 8. Open-Meteo Tool Targets

Expected tool set (3-5):
- `search_location` (`geocoding-api.open-meteo.com/v1/search`)
- `get_forecast` (`api.open-meteo.com/v1/forecast`)
- `get_historical` (`api.open-meteo.com/v1/archive`)
- `get_air_quality` (`api.open-meteo.com/v1/air-quality`)

Important MVP check:
- At least one multi-domain operation uses per-operation `servers` override in OpenAPI.

### Benchmark Task Examples (20 total)

Multi-step tasks (require geocoding → API call):
1. "What's the temperature in Berlin right now?"
2. "Will it rain in Tokyo tomorrow?"
3. "Compare temperatures between Paris and London this week"
4. "What was the average temperature in New York in January 2024?"

Single-step tasks (coordinates given):
5. "Get the hourly forecast for lat 52.52, lon 13.41"
6. "What's the wind speed at 35.68N, 139.69E?"

Complex tasks:
7. "Find the warmest day this week in Sydney"
8. "Get the air quality index for Beijing"
9. "Historical precipitation in São Paulo for March 2025"
10. "Compare UV index between Miami and Los Angeles"

With compiled tools: 1-3 CLI calls per task.
With browser-only: 8-20 browser interactions per task.

---

## 9. Delivery Plan (3 Weeks)

### Week 1: Runtime First

- Scaffold CLI project.
- Hand-write Open-Meteo OpenAPI fixture.
- Implement navigator + direct executor + error contract + SSRF.
- Write `scripts/record_open_meteo.ts` (scripted Playwright recorder for Open-Meteo).
- Exit: agent can call fixture tools end-to-end.

### Week 2: Compiler

- Implement recorder/filter/cluster/diff/schema/annotation/generator.
- Generate spec from real recording.
- Compare generated spec behavior with hand-written fixture.
- Exit: generated tools run successfully.

### Week 3: Benchmark + Stabilize

- Build 20-task benchmark harness.
- Build browser-only baseline.
- Implement `openweb <site> test` for regression validation.
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
| Auto vs hand-written parity | Generated spec matches hand-written fixture on all tasks |

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
