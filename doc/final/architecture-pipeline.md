# Architecture: Pipeline Phases & Execution Runtime

*Part of the [openweb design](openweb-design.md). See also: [Compiler Output & Runtime](compiler-output-and-runtime.md), [Security Taxonomy](security-taxonomy.md), [Skill Package Format](skill-package-format.md), [Self-Evolution](self-evolution.md).*

---

## Phase 1: Explore & Record

**Goal:** Capture a causal trace of site interaction — not just network requests, but the mapping between UI events and the API calls they trigger.

**Principle: Agent-first, human-fallback.** The compiler drives the browser using existing browser-use capabilities. A human only intervenes for actions the agent cannot perform (login with 2FA, CAPTCHA, ambiguous real-world choices).

**Implementation:** Use browser-use (79k-star open-source framework, Playwright-based, LLM-driven) for navigation. Run a passive CDP (Chrome DevTools Protocol) recorder underneath, transparent to the navigation agent.

```
Layer 1: Navigation Agent (browser-use or equivalent)
  - Reads a11y tree / screenshots
  - Decides what to click, type, navigate
  - Exercises the site's main flows

Layer 2: Traffic Recorder (CDP, passive)
  - Captures all network traffic + events
  - Transparent to Layer 1
  - Produces C-HAR (Causal HAR) output
```

This is a clean separation of concerns. The recorder doesn't care who's driving — agent or human. The agent doesn't care that it's being recorded.

### C-HAR (Causal HAR)

The project's foundational data structure. Standard HAR captures what was requested. C-HAR captures *why* — mapping each network request to the UI event that triggered it. Without causality, you can't distinguish user-triggered API calls from background telemetry, polling, prefetch, and ad requests.

### Minimal Capture Set

| Data | Source | Purpose |
|---|---|---|
| HTTP request/response pairs | CDP Network domain | Raw API surface |
| Request initiator (call stack) | CDP `requestWillBeSent.initiator` | Causality: user action vs background |
| UI events with timestamps | CDP Input domain / Playwright hooks | Event-to-request mapping |
| Cookies/session state | CDP Storage + Network | Identify auth dependencies |

Screenshots and a11y snapshots are captured only at key interaction points (for debugging), not continuously. This keeps recording lightweight.

### Exploration Strategy

1. Load the site. Agent reads the page.
2. Agent identifies interactable elements and exercises them (breadth-first).
3. For forms, agent tries different inputs.
4. Each flow is repeated with 2-3 parameter variations to enable clustering.
5. Human intervenes only for: login, CAPTCHA, 2FA, or agent stuck > N actions.

**No pre-built "domain intent library."** The task plan emerges from the site's actual UI, not from a category template. This is more robust and requires zero domain-specific knowledge upfront. (If the knowledge base later accumulates domain patterns, they serve as hints, not prescriptions.)

### Variance Generation

Only for read operations. Write flows are recorded once to avoid side effects. Re-running flows with different parameters generates the variance needed for clustering:

```
Flow: "search for product"
  Run 1: search("laptop")           -> records traffic
  Run 2: search("headphones")       -> records traffic
  Run 3: search("running shoes")    -> records traffic

These 3 recordings let Phase 2 diff the requests and identify
which fields are user-input vs constant.
```

### Human Handoff (Only When Needed)

| Blocker | Agent's action |
|---|---|
| Login page (no credentials provided) | Pause, open headed browser, ask human to log in. Resume. |
| CAPTCHA / challenge | Pause, show to human, resume after solved. |
| 2FA / SMS verification | Pause, ask human to complete, resume. |
| Agent stuck > N actions | Pause, ask human to demonstrate. |

### Recording Resilience (Error Handling)

- **Site returns 500s:** Log the error, retry once, skip the flow if persistent. Don't treat server errors as pipeline failures.
- **Rate limiting (429):** Back off, slow down, continue with longer intervals.
- **Geo-fencing:** Document the issue. May require proxy configuration.

### Stopping Criteria

- 3 parameter variations per flow
- Stop when no new endpoints are discovered for 2 consecutive flows
- Rough guideline: 5-15 flows for a typical site

**Output:** `recording/` directory containing C-HAR files, one per explored flow.

---

## Phase 2: Analyze & Extract

**Goal:** Transform raw recordings into a canonical API map — parameterized endpoint templates with inferred schemas.

### Four Sub-Steps with Clear Contracts

```
Step A: Clustering
  Input:  C-HAR recordings
  Output: Endpoint groups (requests grouped by method + URL pattern + content-type)

Step B: Parameter Differentiation
  Input:  Endpoint groups
  Output: Parameterized templates (user-input vs session vs CSRF vs constant)

Step C: Schema Induction
  Input:  Parameterized templates + response samples
  Output: JSON Schemas for request/response bodies

Step D: Dependency Graph
  Input:  All schemas + C-HAR causality data
  Output: Inter-endpoint data flow DAG (A.response.X → B.request.Y)
```

Each step has clear input → output, making it independently testable and replaceable.

### Step A: Endpoint Clustering

Group requests by `(HTTP method, URL path pattern, Content-Type, GraphQL operationName)`.

```
Concrete requests:
  GET /api/search?q=laptop&page=1&sort=price
  GET /api/search?q=phone&page=2&sort=rating

Clustered endpoint:
  GET /api/search?q={query}&page={page}&sort={sort_by}
```

Algorithm:
1. Parse URLs into `(scheme, host, path_segments[], query_params{})`.
2. Group by `(method, path_segment_count, param_key_set)`.
3. Within each group, align path segments; segments that vary become `{param}`.
4. For query parameters: constant values are defaults, varying values are parameters.

**GraphQL:** Cluster by `operationName` (or `extensions.persistedQuery.sha256Hash` for persisted queries) instead of URL. Variables become tool parameters; the query itself becomes the template.

**Existing tooling:** mitmproxy2swagger already converts HAR/mitmproxy captures to OpenAPI 3.0 specs. Evaluate using it as a starting point for clustering and adapt from there, rather than building from scratch. Our additions beyond mitmproxy2swagger: causal filtering, parameter classification, semantic annotation, dependency graph.

### Step B: Parameter Differentiation

For each clustered endpoint, classify every variable field:

| Type | Signal | Example |
|---|---|---|
| **User input** | Varies freely, maps to UI control | `q=laptop`, `destination=SFO` |
| **Pagination / cursor** | Monotonic, appears in sequence | `page=2`, `cursor=eyJhZG...` |
| **Session token** | Same within session, changes across | `Cookie: session=abc123` |
| **CSRF / nonce** | Changes every request | `X-CSRF-Token: a8f3...` |
| **Derived / computed** | Hash/timestamp, not user-controlled | `_t=1708900000`, `sig=hmac(...)` |
| **Constant** | Same value always | `format=json`, `v=2` |

Classification: heuristic rules (entropy analysis, pattern matching) + LLM-assisted semantic labeling (match field names to UI labels from DOM).

### Step C: Schema Induction

For each endpoint's request body and response body (when JSON):

1. **Structural inference:** Merge observed JSON samples into unified JSON Schema (types, required fields, array item schemas, nullable fields).
2. **Semantic annotation:** LLM generates human-readable field descriptions by correlating field names, value distributions, UI context.

### Step D: Dependency Graph

Map the causal chain between endpoints:

```
search_flights(origin, dest, date)
  -> response contains flight_offer_ids[]
    -> get_offer_details(offer_id)
      -> response contains fare_key
        -> create_booking(fare_key, passenger_info)
```

Extracted from C-HAR causality data: when response field X from endpoint A appears as request field Y in endpoint B, there is a data dependency `A.response.X -> B.request.Y`.

**Confidence scoring:** Each dependency link gets a confidence score. Links based on unique IDs (UUIDs, session-specific tokens) get high confidence. Links based on common values (timestamps, generic numbers) get low confidence. Low-confidence links require human confirmation before being used.

**Output:** `api-map/` directory with endpoints, schemas, and dependencies.

---

## Phase 3: Probe & Classify Execution Requirements

**Goal:** Empirically determine the cheapest execution mode that works for each endpoint.

Full probing protocol documented in **[security-taxonomy.md](security-taxonomy.md)**.

**Summary:** For each endpoint, try cheap modes first and escalate on failure: direct HTTP → with cookies → with CSRF → headless browser → headed browser → needs human. Stop at the first mode that succeeds. This is ≤6 requests per endpoint.

Write endpoints skip probing and default to `browser_fetch`.

**Output:** Per-endpoint execution strategy, stored alongside each tool definition.

---

## Phase 4: Generate & Test

**Goal:** Produce a deployable per-website skill package.

### Tool Synthesis

Each semantically meaningful endpoint becomes an OpenAPI operation. The format uses OpenAPI 3.1 with `x-openweb` vendor extensions for runtime metadata. See [compiler-output-and-runtime.md](compiler-output-and-runtime.md) for the full format rationale.

Example operation in the generated `openapi.yaml`:

```yaml
/api/search:
  get:
    operationId: search_flights
    summary: Search for flights between two airports on a given date
    x-openweb:
      mode: browser_fetch
      human_handoff: false
      session:
        csrf: "document.querySelector('meta[name=csrf]').content"
    parameters:
      - name: origin
        in: query
        required: true
        schema: { type: string }
        description: "Origin airport IATA code"
      - name: destination
        in: query
        required: true
        schema: { type: string }
        description: "Destination airport IATA code"
      - name: departure_date
        in: query
        required: true
        schema: { type: string, format: date }
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
```

Key design decisions:
- **Standard format**: OpenAPI 3.1 — no custom tool definition format to learn. Existing tooling (Swagger UI, Postman) works out of the box.
- **One spec per site**: All operations in a single `openapi.yaml`. CLI extracts per-operation views for progressive disclosure.
- **Runtime metadata via extensions**: `x-openweb.mode`, `x-openweb.session`, `x-openweb.human_handoff` — genuinely new information that OpenAPI doesn't describe, with zero duplication.
- **Zero parameter duplication**: Parameters described once in OpenAPI's native format (path, query, requestBody), used for both agent discovery and request construction.
- UI automation procedures (browser-use-style step-by-step instructions) are **not** part of the OpenAPI spec. They live in separate markdown files as agent instructions — a fundamentally different artifact (non-deterministic agent procedure vs. deterministic API call).
- CSRF extractors: inline expressions in `x-openweb.session` for simple cases; external `.js` files in `extractors/` for complex extraction.
- Operation naming: `{verb}_{object}` via `operationId` (e.g., `search_flights`, `get_details`, `add_to_cart`).

### Compiler Output (No Framework-Specific Emission)

Phase 4 produces **only** the canonical skill package:

```
<site>/
├── manifest.json
├── openapi.yaml       ← OpenAPI 3.1 + x-openweb extensions (canonical output)
├── extractors/        ← complex session/CSRF scripts (optional)
└── tests/             ← regression tests
```

All agent-specific formats (SKILL.md, MCP tool registration, OpenAI/Anthropic/Gemini schemas) are generated **on demand** by the CLI from the OpenAPI spec, not by the compiler. This keeps the compiler simple and decoupled from the rapidly-changing agent ecosystem.

### No Workflow YAML DSL for MVP

The dependency graph (`A.response.X → B.request.Y`) in `manifest.json` + clear tool descriptions provides sufficient multi-step guidance for LLM agents. Add workflows later only if agents consistently fail at sequencing.

### Test Generation

For each tool:
- Input: parameter combinations observed during recording
- Expected output: response schema conformance (not exact values)
- Smoke test: execute each tool once against live site during generation

### Fingerprinting

Compute version hash from: JS bundle hashes + API endpoint set hash + response shape hashes. Stored in `manifest.json`. Used to detect site changes.

**Output:** A complete skill package directory. See [skill-package-format.md](skill-package-format.md) for the structure.

---

## Execution Runtime

### Execution Engine

The CLI executor handles tool calls by reading the OpenAPI operation, constructing the HTTP request, and managing session/browser context based on `x-openweb.mode`:

```
openweb <site> exec <tool> '{args}'
  ├─ Read OpenAPI operation for <tool>
  ├─ Construct HTTP request from OpenAPI path/method/params/requestBody
  ├─ mode = direct_http?
  │    └─ Send HTTP request → success? return JSON to stdout
  │                         → fail? escalate to session_http
  ├─ mode = session_http?
  │    └─ Send HTTP request with session cookies (+ CSRF if needed)
  │       → success? return JSON to stdout
  │       → fail? escalate to browser_fetch
  ├─ mode = browser_fetch?
  │    └─ Execute via Playwright page.evaluate(fetch(...))
  │       → success? return JSON to stdout
  │       → fail? check human_handoff flag
  └─ human_handoff = true?
       └─ Open headed browser, execute auto steps,
          pause for human at marked steps
          → success? return JSON to stdout
          → fail? trigger self-heal
```

For `session_http` execution:
1. Extract cookies from the browser session's cookie jar
2. Optionally extract CSRF token (from meta tag / cookie / API response)
3. Send HTTP request via `node-fetch` with cookies + CSRF header
4. Return parsed JSON response

For `browser_fetch` execution, a JavaScript bridge injected via `page.evaluate()`:
1. Reads current CSRF token / session state from DOM/cookies/localStorage
2. Constructs the request from OpenAPI operation spec + current state + user inputs
3. Executes via `fetch()` within the page context (same origin, same cookies, same TLS)
4. Returns parsed JSON response

For signed/encrypted payloads: call the site's own signing functions via `page.evaluate()` rather than reverse-engineering them.

### Serving Interface: CLI-first, Agent-Agnostic

| Interface | Consumer | Priority |
|---|---|---|
| CLI (`openweb <site> exec`) | Any coding agent (Claude Code, Codex, Cursor, Copilot) | MVP |
| CLI (`openweb <site> <tool>`) | Any coding agent (spec navigation) | MVP |
| OpenAPI export | Human developers, API gateways | MVP+1 |
| MCP adapter (`openweb mcp-serve`) | Agents without shell access | Optional |

See [compiler-output-and-runtime.md](compiler-output-and-runtime.md) for the complete CLI command reference and design rationale.

### Self-Healing

When a tool starts failing:

1. **Detect:** Response schema validation fails. Compare current fingerprint against stored.
2. **Minimal fallback:** Escalate execution mode to complete the immediate task.
3. **Re-record:** Run Phase 1 for the failing flow only.
4. **Diff:** Compare new vs stored: endpoint changed? fields renamed? new required params?
5. **Patch:** Auto-update the OpenAPI spec operations.
6. **Test:** Run the tool's test suite.
7. **Publish policy:**
   - Read-only tool changes: auto-publish if tests pass.
   - Write operation tool changes: **require human approval** before publishing.

Consistent mode escalation triggers re-probing.
