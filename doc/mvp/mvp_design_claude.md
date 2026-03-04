# openweb MVP-1 Design

> **Author**: Claude (Opus 4.6)
> **Date**: 2026-03-04
> **Principle**: KISS + First-Principles. Every decision justified from the problem, not from convention.
> **Relationship to full design**: This is the smallest viable slice of `doc/final/`. It does not redesign — it cuts.

---

## 0. The One Sentence

**Given recorded web traffic, automatically produce typed API tools that make AI agents dramatically faster, cheaper, and more reliable at web tasks than browser automation.**

MVP-1 proves this for one easy site. If it works here, the architecture scales to harder sites.

---

## 1. What MVP-1 Proves

```
Today (browser-use agent):
  Agent → read a11y tree → find search box → type "Berlin" → click submit
    → wait → read DOM → parse results → extract data
    → 10-20 tool calls → ~30 seconds → fragile

After MVP-1 (compiled tools):
  Agent → openweb open-meteo exec get_forecast '{"latitude":52.52,"longitude":13.41}'
    → {"hourly":{"temperature_2m":[12.3,13.1,...]}}
    → 1 call → ~200ms → reliable
```

**The proof**: Run 20 weather tasks. Measure step count, latency, success rate, token cost. Show compiled tools win on every metric.

---

## 2. Scope

### In

- **Recording**: Playwright `record_har` + UI action sidecar, manual browsing mode
- **Analysis**: URL clustering + parameter differentiation + schema inference (quicktype) + LLM naming
- **Output**: OpenAPI 3.1 + `x-openweb` extensions
- **CLI**: spec navigator (list sites/tools/params) + executor (build URL → fetch → return JSON)
- **Benchmark**: automated comparison vs browser-only agent, 20 tasks
- **Target**: Open-Meteo (read-only, public, no auth)
- **Execution mode**: `direct_http` only (pure HTTP, no browser at runtime)

### Out (and why)

| Feature | Why Not Now | When |
|---|---|---|
| Navigation agent | KISS — manual recording works for one site. Prove pipeline first. | MVP-1.5 |
| Phase 3 probing | Open-Meteo is direct_http. Nothing to probe. | MVP-2 |
| Write operations | Open-Meteo is read-only. | MVP-2 |
| Session/auth | No auth needed. | MVP-2 |
| Self-healing | One site, validate manually. | MVP-3 |
| Knowledge base | Nothing to accumulate yet. | MVP-3 |
| GraphQL/WebSocket/protobuf | Open-Meteo is REST/JSON. | MVP-2+ |
| MCP adapter | CLI serves all target agents (Claude Code, Codex, Cursor all have shell). | Post-MVP |
| SKILL.md generation | Hand-write one ~15-line file. | MVP-1.5 |
| Risk classification | Read-only operations, nothing to gate. | MVP-2 |
| Background daemon | No `browser_fetch` mode needed. CLI is fully stateless. | MVP-2 |

---

## 3. Architecture

Strip the full design to its skeleton:

```
┌───────────────────────────────────────────┐
│          COMPILER (build-time)             │
│                                            │
│  Record ──→ Analyze ──→ Generate           │
│  (HAR)      (cluster,   (openapi.yaml      │
│              schema,      manifest.json     │
│              annotate)    tests/)            │
└──────────────┬────────────────────────────┘
               │ produces
               ▼
┌───────────────────────────────────────────┐
│          SKILL PACKAGE (artifact)          │
│  manifest.json + openapi.yaml + tests/     │
└──────────────┬────────────────────────────┘
               │ consumed by
               ▼
┌───────────────────────────────────────────┐
│          CLI RUNTIME                       │
│  Navigator (discover/understand)           │
│  Executor  (direct_http fetch)             │
└───────────────────────────────────────────┘
```

Three components. Three concerns. That's it.

**What's removed vs full design**:
- Phase 3 (Probe) — Open-Meteo is public, hardcode `direct_http`
- Session manager, background daemon — no auth, no `browser_fetch`
- Self-healing, knowledge base — one site, validate manually
- MCP adapter, SKILL.md generator — CLI is sufficient

---

## 4. Phase 1: Record

### Goal

Capture HTTP traffic from the user interacting with Open-Meteo.

### Approach: Manual Browsing (Interactive Mode)

```bash
$ openweb compile https://open-meteo.com --interactive
# [Opens headed Chrome with HAR recording enabled]
# [User browses: try 3 locations × 2 feature types ≈ 6 flows]
# [User closes browser → pipeline processes recording]
# [Done: ~/.openweb/sites/open-meteo/]
```

Playwright launches a headed Chrome. Behind the scenes, `record_har` captures all network traffic. UI actions are captured via injected event listeners (`click`, `input`, `submit`, `change`).

### Instructions Shown to User

```
Browse the site normally. To help us learn the API patterns:
  1. Try the same feature with different inputs
     (e.g., search weather for Berlin, Tokyo, New York)
  2. Try different features (forecast, historical, air quality)
  3. Repeat key actions 2-3 times with different values
  4. Close the browser when done.
```

This variance generation is critical — the analyzer needs multiple requests to the same endpoint with different parameters to distinguish user input from constants.

### Capture-Time Filtering

Two filters DURING recording, before saving to HAR:

1. **Domain blocklist** (~40 domains): Google Analytics, Segment, Mixpanel, Amplitude, Hotjar, Heap, PostHog, Sentry, Datadog, New Relic, Rollbar, DoubleClick, Facebook pixel, Criteo, Intercom, Zendesk. Subdomain matching (`*.google-analytics.com`).

2. **Content-type filter**: Keep `application/json`, `text/json`, `application/vnd.api+json`, `application/x-www-form-urlencoded`, `application/graphql+json`. Skip images, CSS, fonts, HTML (unless navigation target).

This reduces HAR volume by 60-80% before Phase 2 even starts.

### Output

```
recording/
├── traffic.har            # Playwright record_har (standard HAR, zero custom code)
├── ui_actions.jsonl       # One line per action: {timestamp_ms, action, selector, value, url}
└── metadata.json          # {site, recorded_at, flows_count, duration_ms}
```

### Why Not Agent-Driven Exploration for MVP-1?

KISS. Manual recording for Open-Meteo takes 5 minutes and produces clean input. The navigation agent adds:
- ~200-300 lines of Playwright + LLM code
- LLM API calls during recording (cost + latency)
- Exploration strategy + stopping criteria
- Error handling for when the agent gets confused

Build it as MVP-1.5, the first post-MVP enhancement. The pipeline is identical regardless of who drives the browser.

---

## 5. Phase 2: Analyze

### Goal

Transform raw HAR into parameterized endpoint templates with typed schemas and human-readable names.

This is the core of the compiler. The novel, hard, differentiating work lives here.

### Step A: Filter + Cluster

**Input**: `traffic.har` (pre-filtered at capture time)
**Output**: Endpoint groups

1. **Path noise filter**: Skip `/monitoring`, `/telemetry`, `/track`, `/health`, `/ping`, `/manifest.json`, `/_next/static/*`, `/_next/data/*`, `/__vite_*`, `/hot-update.*`. Only keep 2xx responses.

2. **Parse** each request into `{method, host, path_segments[], query_params{}}`.

3. **Normalize** path segments via regex:

```javascript
const PARAM_PATTERNS = [
  { pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, name: 'id' },
  { pattern: /^\d{3,}$/, name: 'id' },
  { pattern: /^[0-9a-f]{8,}$/i, name: 'hash' },
  { pattern: /^[A-Za-z0-9+/=]{16,}$/, name: 'token' },
  { pattern: /^\d{4}-\d{2}-\d{2}/, name: 'date' },
];
```

4. **Group** by `(method, host, normalized_path, sorted_query_param_keys)`.

**Example**:
```
Input:
  GET https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&hourly=temperature_2m
  GET https://api.open-meteo.com/v1/forecast?latitude=35.68&longitude=139.69&hourly=precipitation

Output:
  Group: GET api.open-meteo.com /v1/forecast {hourly, latitude, longitude}
    ├── request 1: {latitude: "52.52", longitude: "13.41", hourly: "temperature_2m"}
    └── request 2: {latitude: "35.68", longitude: "139.69", hourly: "precipitation"}
```

### Step B: Parameter Differentiation

**Input**: Endpoint groups (multiple requests per group)
**Output**: Per-parameter classification

For each parameter across all requests in a group:

| Pattern | Classification | Example |
|---|---|---|
| Same value in ALL requests | **Constant** → bake as default | `format=json` |
| Different values across requests | **User input** → exposed param | `latitude=52.52` vs `35.68` |
| Present in some requests, absent in others | **Optional** user input | `daily` param sometimes omitted |

This is pure set-diff logic. No LLM needed. Compare parameter values across the 2-3+ recordings per endpoint group.

### Step C: Schema Inference

**Input**: Response bodies from each endpoint group
**Output**: JSON Schema for each response (and request body if applicable)

Use `quicktype-core` (TypeScript library):
1. Collect all response JSON samples for an endpoint group
2. Feed them into quicktype together → produces merged JSON Schema
3. quicktype handles: union types, optional fields, array item inference, format detection
4. For request parameters: infer types from observed values (number, string, boolean, enum)

**Why quicktype**: It's battle-tested, handles multi-sample aggregation correctly, and is native TypeScript. Hand-rolled schema inference is the #1 source of bugs across reference projects. Don't reinvent this wheel.

### Step D: LLM Semantic Annotation

**Input**: Endpoint templates + schemas
**Output**: Named operations with descriptions

Prompt Claude Haiku:

```
Given these API endpoints extracted from open-meteo.com:

Endpoint 1:
  GET /v1/forecast
  Parameters: latitude (number), longitude (number), hourly (string[]), ...
  Response sample: {"latitude":52.52,"hourly":{"time":["2026-03-04T00:00",...],...}}

Endpoint 2:
  GET /v1/search
  Host: geocoding-api.open-meteo.com
  Parameters: name (string), count (number), language (string)
  Response sample: {"results":[{"name":"Berlin","latitude":52.52,...}]}

For each endpoint, generate:
1. operationId (verb_object format, e.g., "get_forecast")
2. summary (one clear sentence)
3. Parameter descriptions (one sentence each)
```

**Batching**: Group all endpoints into 1-2 LLM calls (Open-Meteo has ~4-5 endpoints).

**Fallback**: If LLM unavailable, use mechanical names: `GET /v1/forecast` → `get_v1_forecast`. Ugly but functional. The pipeline works without LLM — just with worse names.

**Cost**: ~2-3 LLM calls, ~$0.05-$0.20 with Haiku for Open-Meteo.

### Phase 2 Output

Intermediate data passed to Phase 4 generator. No need to persist — this is an in-memory pipeline.

---

## 6. Phase 4: Generate

### Goal

Produce the skill package from analyzed data.

### OpenAPI 3.1 + x-openweb Extensions

```yaml
openapi: "3.1.0"
info:
  title: Open-Meteo
  description: Weather forecast, historical data, geocoding, and air quality APIs
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
        human_handoff: false
        risk_tier: safe
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
          description: "Hourly variables: temperature_2m, precipitation, wind_speed_10m, ..."
        - name: daily
          in: query
          schema:
            type: array
            items: { type: string }
          description: "Daily variables: temperature_2m_max, precipitation_sum, ..."
        - name: timezone
          in: query
          schema: { type: string }
          description: "Timezone (e.g., Europe/Berlin, America/New_York)"
      responses:
        "200":
          description: Weather forecast data
          content:
            application/json:
              schema:
                type: object
                properties:
                  latitude: { type: number }
                  longitude: { type: number }
                  hourly:
                    type: object
                    description: "Hourly weather data arrays"
                  daily:
                    type: object
                    description: "Daily weather data arrays"

  /v1/search:
    get:
      operationId: search_location
      summary: Search for a location by name (geocoding)
      x-openweb:
        mode: direct_http
        risk_tier: safe
      servers:
        - url: https://geocoding-api.open-meteo.com
      parameters:
        - name: name
          in: query
          required: true
          schema: { type: string }
          description: "Location name to search for"
        - name: count
          in: query
          schema: { type: integer, default: 10 }
          description: "Maximum number of results"
        - name: language
          in: query
          schema: { type: string }
          description: "Language for location names (e.g., en, de, zh)"
      responses:
        "200":
          description: Matching locations
          content:
            application/json:
              schema:
                type: object
                properties:
                  results:
                    type: array
                    items:
                      type: object
                      properties:
                        name: { type: string }
                        latitude: { type: number }
                        longitude: { type: number }
                        country: { type: string }
                        timezone: { type: string }

  # ... similar entries for get_historical, get_air_quality
```

Note: `search_location` uses a per-operation `servers` override (`geocoding-api.open-meteo.com` vs `api.open-meteo.com`). This tests multi-domain handling even in MVP.

### manifest.json

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

One real dependency: `search_location` provides lat/lon for `get_forecast`. This validates the dependency graph mechanism even in MVP.

### Test Files

One file per operation, asserting schema conformance (not exact values):

```json
{
  "operation_id": "get_forecast",
  "cases": [
    {
      "name": "berlin_hourly",
      "input": {
        "latitude": 52.52,
        "longitude": 13.41,
        "hourly": ["temperature_2m"]
      },
      "assertions": {
        "status": 200,
        "response_schema_valid": true,
        "response_contains": {
          "hourly": { "type": "object" },
          "hourly.time": { "type": "array", "min_length": 1 },
          "hourly.temperature_2m": { "type": "array", "min_length": 1 }
        }
      }
    }
  ]
}
```

### Smoke Test

During generation, execute each tool once against the live site. If any tool fails, the generation reports a warning but still emits the spec (the site might be temporarily down).

### Skill Package Output

```
~/.openweb/sites/open-meteo/
├── manifest.json
├── openapi.yaml
└── tests/
    ├── get_forecast.test.json
    ├── search_location.test.json
    ├── get_historical.test.json
    └── get_air_quality.test.json
```

Four files + test directory. Each earns its place.

---

## 7. CLI Runtime

### Commands

```bash
# Discovery (progressive spec navigation)
openweb sites                                    # List installed sites
openweb open-meteo                               # List tools (name + summary)
openweb open-meteo get_forecast                  # Show params + response shape
openweb open-meteo get_forecast --full           # Full OpenAPI YAML for debugging

# Execution
openweb open-meteo exec get_forecast '{"latitude":52.52,"longitude":13.41,"hourly":["temperature_2m"]}'
# → JSON on stdout

# Compilation
openweb compile https://open-meteo.com --interactive

# Testing
openweb open-meteo test                          # Run test suite for a site
```

### Executor (`direct_http`)

The entire executor for MVP-1 is ~50 lines:

```typescript
async function execute(site: string, tool: string, params: Record<string, any>) {
  const spec = loadOpenAPI(site);
  const op = findOperation(spec, tool);
  const serverUrl = getServerUrl(spec, op);  // handles per-operation override
  const url = buildQueryUrl(serverUrl, op.path, op.parameters, params);

  validateSSRF(url);  // MANDATORY — non-negotiable

  const res = await fetch(url, {
    method: op.method.toUpperCase(),
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    writeErrorToStderr({ code: 'EXECUTION_FAILED', message: `HTTP ${res.status}`, retriable: res.status === 429 });
    process.exit(1);
  }

  const json = await res.json();
  // Optional: validate response against schema (warn on mismatch, don't fail)
  process.stdout.write(JSON.stringify(json));
}
```

No browser. No session. No daemon. URL construction + fetch. That's it.

### SSRF Protection

Applied on every outbound request:

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

This is mandatory from day 1. The executor takes user-provided params and constructs HTTP requests — SSRF is a real risk.

### Navigator (Progressive Disclosure)

Reads `openapi.yaml` and formats output for minimal agent token usage:

```
$ openweb open-meteo
search_location       Search for a location by name (geocoding)
get_forecast          Get hourly and daily weather forecast for a location
get_historical        Get historical weather data for a location
get_air_quality       Get air quality data for a location

$ openweb open-meteo get_forecast
GET /v1/forecast
  latitude:   number  Latitude in decimal degrees (e.g., 52.52)        [required]
  longitude:  number  Longitude in decimal degrees (e.g., 13.41)       [required]
  hourly:     string[]  Hourly variables (temperature_2m, precipitation, ...)
  daily:      string[]  Daily variables (temperature_2m_max, precipitation_sum, ...)
  timezone:   string  Timezone (e.g., Europe/Berlin)
Returns: { latitude, longitude, hourly: { time[], temperature_2m[], ... }, daily: {...} }
Mode: direct_http
```

~150 tokens for one tool view. vs ~3000-5000 for loading all tools via MCP. This 10-20x token reduction is the key UX advantage of CLI-first.

### Error Contract

Success: JSON on stdout, exit 0. Error: JSON on stderr, exit 1.

```json
{
  "error": "execution_failed",
  "code": "INVALID_PARAMS",
  "message": "Missing required parameter: latitude",
  "retriable": false
}
```

Minimal error codes for MVP:

| Code | Meaning |
|---|---|
| `EXECUTION_FAILED` | HTTP request failed |
| `TOOL_NOT_FOUND` | Unknown site or operation |
| `INVALID_PARAMS` | Parameters don't match schema |

---

## 8. Target Site: Open-Meteo

### Why This Site

| Criterion | Open-Meteo |
|---|---|
| Public API, no auth | Yes — free, no API key, no rate limit for reasonable use |
| Clean REST/JSON | Yes |
| Real UI to record from | Yes — location search, variable selectors, date pickers |
| Documented (for validation) | Yes — can compare compiler output against official docs |
| Stable | Yes — API rarely changes |
| Multi-domain | Yes — `api.open-meteo.com` + `geocoding-api.open-meteo.com` |
| Difficulty | Level 1 (easiest possible) |

### Expected Tools (3-5)

| Tool | Host | Endpoint | Key Params |
|---|---|---|---|
| `search_location` | geocoding-api | `GET /v1/search` | name, count, language |
| `get_forecast` | api | `GET /v1/forecast` | latitude, longitude, hourly[], daily[], timezone |
| `get_historical` | api | `GET /v1/archive` | latitude, longitude, hourly[], daily[], start_date, end_date |
| `get_air_quality` | api | `GET /v1/air-quality` | latitude, longitude, hourly[] |

### Benchmark Tasks (20 examples)

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

## 9. Tech Stack

| Component | Choice | Why |
|---|---|---|
| Language | TypeScript | Playwright native, quicktype is TS, single-language stack |
| Browser automation | Playwright | Best CDP integration, built-in `record_har` |
| Schema inference | `quicktype-core` | Multi-sample aggregation, union types, battle-tested |
| CLI framework | `yargs` | Minimal, sufficient |
| LLM | Claude Haiku via `@anthropic-ai/sdk` | Cheapest, fast, good enough for naming |
| HTTP client | Node native `fetch` | Zero deps for executor |
| Build | `tsup` | Fast TS → JS bundling |
| Package manager | `pnpm` | Fast, disk-efficient |
| Testing | `vitest` | Fast, TS-native, good enough |

### Project Structure

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
```

~15 files. Each file has one job. No file should exceed ~300 lines.

---

## 10. Build Order

Bottom-up. Always have something working to demo.

### Milestone 1: Working Runtime (Week 1)

**Goal**: `openweb open-meteo exec get_forecast '...'` returns real weather data.

| Day | Task |
|---|---|
| 1 | Project scaffolding: TS, Playwright, yargs, tsup, vitest |
| 2 | Hand-write `openapi.yaml` for Open-Meteo (4 operations, based on official docs) |
| 3 | Implement executor: read OpenAPI → build URL → SSRF check → fetch → validate → stdout |
| 4 | Implement navigator: `openweb sites`, `openweb <site>`, `openweb <site> <tool>` |
| 5 | Implement error contract. Wire CLI commands. End-to-end: agent calls CLI, gets data. |

**Exit criteria**: An agent (Claude Code or Codex) can discover and call all 4 Open-Meteo tools via CLI. The spec is hand-written, but the full runtime works.

**Why runtime first**: The hand-written spec serves as a test fixture for the compiler. We know exactly what correct output looks like before building the thing that produces it.

### Milestone 2: Compiler Pipeline (Week 2)

**Goal**: `openweb compile https://open-meteo.com --interactive` produces a spec comparable to the hand-written one.

| Day | Task |
|---|---|
| 6 | Recorder: launch headed Chrome, record HAR, capture UI actions, save recording/ |
| 7 | Filter: domain blocklist + content-type + path noise → clean HAR entries |
| 8 | Cluster: URL normalization + grouping. Differentiate: cross-request parameter diffing |
| 9 | Schema: quicktype-core wrapper. Feed response samples, get JSON Schemas. |
| 10 | Annotate: LLM prompt for naming + descriptions. Fallback to mechanical names. |
| 11 | Generator: emit openapi.yaml + manifest.json + tests/ from analyzed data |
| 12 | Integration test: record Open-Meteo → analyze → generate → compare to hand-written spec |

**Exit criteria**: Auto-generated spec produces identical results to hand-written spec for all test tasks. Diff is only cosmetic (description wording, field ordering).

### Milestone 3: Benchmark + Polish (Week 3)

**Goal**: Quantified proof that compiled tools beat browser-only.

| Day | Task |
|---|---|
| 13 | Design 20 benchmark tasks. Implement benchmark harness (run task, measure metrics). |
| 14 | Set up browser-only baseline (Playwright MCP or browser-use agent). |
| 15 | Run both approaches, collect data. |
| 16 | Polish: fix issues found in benchmarking, improve CLI output formatting. |
| 17 | Implement `openweb <site> test` for regression testing. Final pass. |

**Exit criteria**: Quantified comparison showing ≥60% step reduction, ≥80% success rate, latency and cost improvements documented.

---

## 11. Success Criteria

| Metric | Target | How Measured |
|---|---|---|
| **Tools produced** | 3-5 working read-only tools | Count operations in openapi.yaml |
| **Task success rate** | ≥85% on 20 tasks | Benchmark harness: task completed correctly |
| **Step reduction** | ≥60% vs browser-only | CLI calls vs browser tool calls for same task |
| **Latency per task** | <2s average | Benchmark timing (network round-trip) |
| **Compilation cost** | <$1 LLM cost per site | Track API usage during compile |
| **Schema accuracy** | 100% of responses pass validation | `openweb open-meteo test` passes |
| **Auto vs hand-written parity** | Generated spec matches hand-written on all tasks | Diff test |

---

## 12. Key Design Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Manual recording for MVP-1 | 5 min of browsing vs 300 lines of agent code. Prove the pipeline first, automate the input second. |
| D2 | Skip Phase 3 (probing) | Open-Meteo is public API. Hardcode `mode: direct_http`. Probing adds value only when auth/CSRF exists. |
| D3 | Build bottom-up (runtime first) | Hand-written spec validates runtime immediately. Always have a working demo. Compiler quality measured against known-good spec. |
| D4 | OpenAPI 3.1 as canonical output | Standard format. No custom tooling to build/learn. Swagger UI, Postman, code generators work out of the box. |
| D5 | quicktype for schema inference | Best-in-class multi-sample aggregation. TypeScript native. Don't reinvent schema inference. |
| D6 | Claude Haiku for annotation | Naming + descriptions don't need a powerful model. ~$0.10 per site. |
| D7 | No background daemon | `direct_http` needs no browser at runtime. CLI is fully stateless per-invocation. Zero operational complexity. |
| D8 | SSRF protection from day 1 | Executor takes user params → constructs HTTP requests. SSRF is a real attack vector. Non-negotiable. |
| D9 | File-system for everything | `~/.openweb/sites/` is the registry. No DB, no daemon, no state server. `ls` is the discovery mechanism. |
| D10 | Benchmark as first-class deliverable | Without measurement, the MVP proves nothing. The benchmark IS the product validation. |

---

## 13. Risk Analysis

| Risk | Impact | Mitigation |
|---|---|---|
| Analyzer produces bad clusters | Pipeline outputs garbage tools | Hand-written spec as test fixture. Diff auto-generated vs hand-written. |
| Open-Meteo is "too easy" | Doesn't prove value for harder sites | That's fine — it validates the pipeline. Harder sites come in MVP-2. |
| LLM names operations poorly | Tools confusing to agents | Mechanical fallback names work. Iterate prompt. Haiku is good enough. |
| quicktype fails on edge cases | Schema inference breaks | quicktype is battle-tested on millions of JSON samples. Manual fix as fallback. |
| Benchmark tasks too artificial | Comparison isn't convincing | Use diverse, realistic weather queries. Include multi-step tasks. |
| Open-Meteo changes API | Tests break during development | Unlikely (stable API). Pin to known-good responses for schema validation. |

---

## 14. What Comes After MVP-1

### MVP-1.5: Automation (Weeks 4-5)
- Navigation agent: LLM reads a11y tree, drives browser, generates variance
- `openweb compile <url>` without `--interactive`
- SKILL.md auto-generation from OpenAPI
- `openweb install <site>` writes SKILL.md to agent workspace

### MVP-2: Second Site + Auth (Weeks 6-9)
- Second site with cookies/CSRF (e.g., moderate SaaS or e-commerce)
- Phase 3: Escalation ladder probing (`direct_http` → `session_http` → `browser_fetch`)
- Write operations + risk classification (`safe`/`low`/`medium`/`high`/`critical`)
- `openweb login <site>`: visible browser → user logs in → cookies captured
- Session management: cookie jar at `~/.openweb/sessions/`
- Background daemon for `browser_fetch` mode
- GraphQL support (if second site uses it)

### MVP-3: Hard Site + Self-Healing (Weeks 10-12)
- Third site: protobuf, TLS fingerprint, complex session (e.g., Google Flights)
- Self-healing: passive detection → re-record → diff → patch
- Encrypted auth store (AES-256-GCM)
- Knowledge base: patterns.md + heuristics.json + failures.md
- Endpoint identity tracking: `stable_id`, `signature_id`, `tool_version`

### The Trajectory

```
MVP-1:  1 easy site, read-only, manual recording, direct_http
MVP-1.5: + agent exploration, SKILL.md
MVP-2:  + auth site, write ops, probing, sessions
MVP-3:  + hard site, self-healing, knowledge base
MVP-4:  10+ sites, knowledge proves compounding value
```

Each step adds ONE new dimension of difficulty. The pipeline grows to handle it. The knowledge base accumulates. The compiler gets smarter.

---

## 15. The First-Principles Argument

Why does this MVP design look the way it does?

**From the mission**: "Let agents access the web easily." The CLI + compiled tools is the easiest possible interface — one command, structured JSON back. No DOM, no screenshots, no coordinates.

**From the thesis**: "Compiled API tools > browser automation." The benchmark proves or disproves this. Everything else (compiler pipeline, CLI, package format) exists to produce the tools and run the benchmark.

**From KISS**: Every component earns its place by being necessary for the benchmark. Recording produces data. Analysis turns data into tools. The CLI serves tools to agents. The benchmark measures the result. Remove any one piece and the proof fails.

**What's NOT justified by first principles**: Navigation agent (manual recording suffices for proof), Phase 3 probing (irrelevant for a public API), self-healing (one site, validate manually), knowledge base (nothing to accumulate), MCP adapter (CLI works for all target agents). So they're all cut.

The MVP is the minimum structure that answers: **"Do compiled API tools make agents better at web tasks?"** If yes, we scale. If no, we learn why and adjust.
