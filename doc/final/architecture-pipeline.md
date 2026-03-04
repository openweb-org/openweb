# Architecture: Pipeline Phases & Execution Runtime

*Part of the [openweb design](openweb-design.md). See also: [Compiler Output & Runtime](compiler-output-and-runtime.md), [Security Taxonomy](security-taxonomy.md), [Skill Package Format](skill-package-format.md), [Self-Evolution](self-evolution.md).*

---

## Phase 1: Explore & Record

**Goal:** Capture site traffic and UI interactions for analysis — HTTP requests via standard HAR, UI actions as a separate event log, with causality inferred post-hoc in Phase 2.

**Principle: Agent-first, human-fallback.** The compiler drives the browser using an LLM-powered navigation agent. A human only intervenes for actions the agent cannot perform (login with 2FA, CAPTCHA, ambiguous real-world choices).

**Implementation:** A minimal Node.js navigation agent (Playwright + LLM, ~200-300 lines) reads the accessibility tree, decides what to click/type/navigate, and exercises the site's main flows. A passive recorder captures traffic underneath, transparent to the navigation agent.

**Default browser mode: real Chrome profile.** The compiler launches the user's actual Chrome via Playwright's `channel: "chrome"` option, copying the real browser profile (cookies, history, fingerprint). This sidesteps bot detection entirely for authenticated sites — the browser IS the user's browser. For sites requiring no auth, a clean Chromium instance is used instead.

```
Layer 1: Navigation Agent (Node.js, Playwright + LLM)
  - Reads a11y tree / screenshots
  - Decides what to click, type, navigate
  - Exercises the site's main flows

Layer 2: Traffic Recorder (Playwright record_har + CDP, passive)
  - Captures all network traffic via Playwright's record_har (standard HAR)
  - Captures UI events as a separate JSONL sidecar
  - Transparent to Layer 1
```

This is a clean separation of concerns. The recorder doesn't care who's driving — agent or human. The agent doesn't care that it's being recorded.

### Recording Format: Standard HAR + UI Action Sidecar

No custom "Causal HAR" format. Reference implementations across the industry unanimously use standard HAR for traffic, with UI events stored separately. Causality (which UI action triggered which request) is inferred post-hoc in Phase 2, not embedded in the recording format.

**Why not a combined format:** CDP `requestWillBeSent.initiator` is unreliable for modern SPAs — request queuing (React Query, SWR), service workers, framework interceptors (axios, ky), and debounced actions all break the initiator chain. Post-hoc inference via temporal proximity is more robust.

**Phase 1 output:**

```
recording/
├── traffic.har            # Playwright record_har, zero custom code
├── ui_actions.jsonl       # One line per action: {timestamp, action, selector, value, url}
└── metadata.json          # flow_id, site, recorded_at, cookies_snapshot, exploration_stats
```

### Three-Layer Traffic Filtering

Pre-filter noise during capture to reduce Phase 2 analysis cost by 60-80%:

**Layer 1: Domain blocklist (capture-time)**
Block analytics (Google Analytics, Segment, Mixpanel, Amplitude, Hotjar, Heap, PostHog), ads (DoubleClick, Facebook, Criteo), error tracking (Sentry, Datadog, New Relic, Rollbar), and social/engagement trackers. Subdomain matching: `*.google-analytics.com`, `*.sentry.io`, etc. ~40+ domains.

**Layer 2: Content-type filter (capture-time)**
Keep: `application/json`, `application/vnd.api+json`, `text/json`, `application/x-www-form-urlencoded`, `application/graphql+json`. Skip: images, CSS, fonts, HTML (unless navigation target).

**Layer 3: Path noise filter (Phase 2 input)**
Static: `/monitoring`, `/telemetry`, `/track`, `/health`, `/ping`, `/manifest.json`. Framework: `/_next/static/*`, `/_next/data/*`, `/__vite_*`, `/hot-update.*`. Only 2xx responses become tool candidates.

### Minimal Capture Set

| Data | Source | Purpose |
|---|---|---|
| HTTP request/response pairs | Playwright `record_har` | Raw API surface (standard HAR) |
| Request initiator (call stack) | CDP `requestWillBeSent.initiator` | Hint for causality (best-effort, not relied upon) |
| UI events with timestamps | Playwright hooks | Separate event log for Phase 2 causality inference |
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

**Output:** `recording/` directory containing HAR file, UI action log, and metadata. One recording directory per explored flow.

---

## Phase 2: Analyze & Extract

**Goal:** Transform raw recordings into a canonical API map — parameterized endpoint templates with inferred schemas.

### Four Sub-Steps with Clear Contracts

```
Step A: Clustering
  Input:  HAR recordings (filtered)
  Output: Endpoint groups (requests grouped by method + URL pattern + content-type)

Step B: Parameter Differentiation
  Input:  Endpoint groups
  Output: Parameterized templates (user-input vs session vs CSRF vs constant)

Step C: Schema Induction
  Input:  Parameterized templates + response samples
  Output: JSON Schemas for request/response bodies

Step D: Dependency Graph
  Input:  All schemas + UI action log timestamps
  Output: Inter-endpoint data flow DAG (A.response.X → B.request.Y)
```

Each step has clear input → output, making it independently testable and replaceable.

### Causality Inference (Pre-Step A)

Before clustering, infer which requests were user-triggered vs background noise. Since CDP `requestWillBeSent.initiator` is unreliable for SPAs, use a multi-signal approach:

1. **Temporal proximity**: Request fires within 500ms of a UI action in `ui_actions.jsonl`, no other UI action intervenes → likely user-triggered.
2. **Domain blocklist**: Requests to analytics/ads/tracking domains (applied in Phase 1) are already removed.
3. **CDP initiator**: Use as a supporting signal (not the primary one). Deep stacks through framework internals still ultimately trace to user code.
4. **URL-pattern clustering**: Requests to the same endpoint template that fire together are likely part of the same user action.

This is best-effort. Phase 2 clustering works with imperfect causality — it just means more noise in initial endpoint groups, which LLM classification can clean up.

### Step A: Endpoint Clustering

Group requests by `(HTTP method, URL path pattern, Content-Type, GraphQL operationName)`.

```
Concrete requests:
  GET /api/search?q=laptop&page=1&sort=price
  GET /api/search?q=phone&page=2&sort=rating

Clustered endpoint:
  GET /api/search?q={query}&page={page}&sort={sort_by}
```

**URL Normalization (regex-based):**

Path segments matching these patterns are replaced with parameter placeholders:

```javascript
const PARAM_PATTERNS = [
  { pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, name: 'id' },
  { pattern: /^\d{3,}$/, name: 'id' },           // 3+ digit numbers
  { pattern: /^[0-9a-f]{8,}$/i, name: 'hash' },  // hex strings ≥8 chars
  { pattern: /^[A-Za-z0-9+/=]{16,}$/, name: 'token' }, // base64 ≥16 chars
  { pattern: /^\d{4}-\d{2}-\d{2}/, name: 'date' }, // ISO date prefix
];
```

Algorithm:
1. Parse URLs into `(scheme, host, path_segments[], query_params{})`.
2. Normalize path segments using regex patterns above.
3. Group by `(method, normalized_path, param_key_set)`.
4. Within each group, align path segments; segments that vary become `{param}`.
5. For query parameters: constant values are defaults, varying values are parameters.

**GraphQL (first-class support):**
1. **Detection**: request to `/graphql` (or similar) with `operationName` or `query` in body.
2. **Clustering key**: `POST + operationName` (not URL path, which is always `/graphql`). Also support `extensions.persistedQuery.sha256Hash` for persisted queries.
3. **Parameter extraction**: GraphQL `variables` → tool parameters. `query` string → fixed template (stored as `const` in requestBody schema with `default` value).
4. **operationId**: `{query|mutation}_{OperationName}` in snake_case (e.g., `query_get_posts`, `mutation_create_post`).
5. **Type inference**: if operation text starts with `mutation` → write operation. Otherwise → read.

**Clustering is reimplemented in Node.js** (~300-500 lines). The algorithm is straightforward URL parsing and grouping. We evaluate mitmproxy2swagger's output on test data as a benchmark, not a dependency.

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

1. **Structural inference via quicktype:** Use `quicktype-core` (TypeScript library) to merge observed JSON samples into unified JSON Schema. quicktype handles multi-sample aggregation, union types, array item inference, and format detection. This replaces hand-rolled schema inference and `json-schema-generator`.
2. **Semantic annotation:** LLM generates human-readable field descriptions by correlating field names, value distributions, UI context. The LLM focuses purely on the semantic layer — structural inference is handled deterministically by quicktype.

**LLM cost model for Phase 2:**
- ~5-15 LLM calls per endpoint (parameter classification, description generation, dependency analysis).
- At ~1K tokens per call, a 10-endpoint site costs ~50-150K tokens ≈ $0.50-$2.00 with Claude Haiku, $3-$10 with Sonnet.
- **Caching**: Cache LLM outputs keyed by (endpoint URL pattern + request/response sample hash). Reuse cached classifications on recompilation with similar traffic.
- **Batching**: Group multiple endpoints into single LLM calls where possible (e.g., "classify these 5 parameters" in one prompt instead of 5 separate calls).
- **Fallback**: Heuristic-only mode (no LLM) for users who want offline compilation. Lower quality but functional — parameter names come from JSON keys, descriptions are blank.

### Step D: Dependency Graph

Map the data flow between endpoints:

```
search_flights(origin, dest, date)
  -> response contains flight_offer_ids[]
    -> get_offer_details(offer_id)
      -> response contains fare_key
        -> create_booking(fare_key, passenger_info)
```

**Algorithm (structural, no LLM needed):**
1. For each source endpoint, extract response schema field names (top-level + array item fields, depth ≤5).
2. For each target endpoint, extract request parameter names (path, query, body).
3. **Exact name match** → confidence 0.9.
4. **Suffix match** (source `"id"` ↔ target `"product_id"`, source path contains `/products`) → confidence 0.6.
5. Filter generic fields: `type`, `status`, `state`, `created_at`, `count`, `total`, `page`, `limit`, `offset`.
6. Keep highest-confidence edge per (source, target) pair.
7. Extract linear chains from root nodes (no incoming edges), following highest-confidence edges greedily.

This runs in O(n²) over endpoints and produces exactly the `dependencies` map that `manifest.json` needs.

**LLM-assisted validation (optional, advanced):** For low-confidence edges (0.6–0.7), present them as "possible dependencies" in the compilation report. High-confidence edges (≥ 0.8) are auto-accepted. This can be deferred — the structural algorithm alone is sufficient for most sites.

Wire the output into `manifest.json.dependencies` and into tool descriptions: `"(Requires offer_id from search_flights)"` — embedding dependency hints in operation summaries.

**Output:** `api-map/` directory with endpoints, schemas, and dependencies.

---

## Phase 3: Probe & Classify Execution Requirements

**Goal:** Empirically determine the cheapest execution mode that works for each endpoint, and record the evidence.

Full probing protocol documented in **[security-taxonomy.md](security-taxonomy.md)**.

**Summary:** For each endpoint, try cheap modes first and escalate on failure: direct HTTP → with cookies → with CSRF → headless browser → headed browser → needs human. Stop at the first mode that succeeds. This is ≤6 requests per endpoint.

Write endpoints skip probing and default to `browser_fetch`.

**Verification approach:**
- GET endpoints: actually replay during Phase 3 probe, check status + response shape.
- Non-GET: heuristic only (header inspection for CSRF/auth). Don't probe write endpoints.

**Probe output — per-endpoint `x-openweb` metadata:**

```yaml
x-openweb:
  mode: session_http          # cheapest working mode
  human_handoff: false
  risk_tier: medium           # safe | low | medium | high | critical (see below)
  verified: true              # was this actually probed, or heuristic-only?
  signals:                    # evidence for the classification
    - "status-match"
    - "auth-required"
```

The `signals` array is debuggable and helps self-healing: if a green endpoint starts failing, the signals show what changed.

### Risk Classification

Deterministic rule-based classification for every endpoint:

| Condition | Tier |
|---|---|
| Auth-related path (`/login`, `/oauth`, `/token`, `/session`) | critical |
| Payment/billing paths (`payment`, `checkout`, `billing`, `refund`) | critical |
| Destructive paths (`delete`, `destroy`, `revoke`, `terminate`) | high |
| HTTP DELETE | high |
| POST/PUT/PATCH with PII fields | high |
| POST/PUT/PATCH (no PII) | medium |
| GET with PII in response | low |
| Everything else (GET, read-only) | safe |

`risk_tier` drives runtime behavior:
- **Confirmation prompts**: `high` and `critical` always confirm. `medium` confirms once per session.
- **Rate limiting**: `safe=120/min, low=60, medium=30, high=10, critical=5`.
- **Self-healing publish policy**: `safe`/`low` auto-publish; `medium`+ require human approval.

**Output:** Per-endpoint execution strategy + risk classification, stored alongside each tool definition.

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
      risk_tier: safe
      stable_id: "a1b2c3d4e5f6g7h8"
      signature_id: "i9j0k1l2m3n4o5p6"
      tool_version: 1
      session:
        page_url: "https://www.google.com/travel/flights"
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
- **Runtime metadata via extensions**: `x-openweb.mode`, `x-openweb.session`, `x-openweb.human_handoff`, `x-openweb.risk_tier`, `x-openweb.stable_id` — genuinely new information that OpenAPI doesn't describe, with zero duplication.
- **Zero parameter duplication**: Parameters described once in OpenAPI's native format (path, query, requestBody), used for both agent discovery and request construction.
- UI automation procedures (browser-use-style step-by-step instructions) are **not** part of the OpenAPI spec. They live in separate markdown files as agent instructions — a fundamentally different artifact (non-deterministic agent procedure vs. deterministic API call).
- CSRF extractors: inline expressions in `x-openweb.session` for simple cases; external `.js` files in `extractors/` for complex extraction. Extractor module contract: exports an async function receiving a Playwright `page` object, returns a string (the token value).
- Operation naming: `{verb}_{object}` via `operationId` (e.g., `search_flights`, `get_details`, `add_to_cart`).
- **Endpoint identity** (three levels for version tracking):
  - `stable_id`: `sha256(method + host + path)[:16]` — survives parameter changes
  - `signature_id`: `sha256(method + host + path + params)[:16]` — changes on breaking changes
  - `tool_version`: integer, incremented on breaking changes — human-readable version

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

### SSRF Protection

Every outbound request from the executor passes through SSRF validation. This is mandatory because openweb takes user-provided parameters and constructs HTTP requests — a malicious or confused agent could craft requests to localhost, cloud metadata endpoints, or internal services.

```javascript
function validateTarget(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('HTTPS required');
  const ips = await dns.resolve(parsed.hostname);
  for (const ip of ips) {
    if (isPrivate(ip)) throw new Error(`Private IP: ${ip}`);
  }
  if (parsed.hostname === '169.254.169.254') throw new Error('Metadata endpoint');
}
```

Applied on every `fetch()` call in the executor, including redirect targets. Localhost exception for dev mode only.

### Execution Engine

The CLI executor handles tool calls by reading the OpenAPI operation, constructing the HTTP request, and managing session/browser context based on `x-openweb.mode`:

```
openweb <site> exec <tool> '{args}'
  ├─ SSRF validation on target URL
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

The `direct_http` executor is minimal (~30 lines): URL construction → SSRF check → auth injection → `fetch()` → schema validation → response. No Playwright, no Chrome, no extra installs. The daemon/session-manager complexity is only needed for `session_http` and `browser_fetch` modes.

For `session_http` execution:
1. Extract cookies from the browser session's cookie jar
2. Optionally extract CSRF token (from meta tag / cookie / API response)
3. Send HTTP request via `node-fetch` with cookies + CSRF header
4. Return parsed JSON response

For `browser_fetch` execution, a JavaScript bridge injected via `page.evaluate()`:
1. Navigate to `x-openweb.session.page_url` (if not already there) before running `page.evaluate()`
2. Reads current CSRF token / session state from DOM/cookies/localStorage
3. Constructs the request from OpenAPI operation spec + current state + user inputs
4. Executes via `fetch()` within the page context (same origin, same cookies, same TLS)
5. Returns parsed JSON response

For signed/encrypted payloads: call the site's own signing functions via `page.evaluate()` rather than reverse-engineering them.

### Session Lifecycle

**MVP-1 (no auth):** No session management needed.

**MVP-2 capture:** Real Chrome profile (user's existing login session inherited during `openweb compile`).

**MVP-2 runtime:** `openweb login <site>` launches a visible browser → user logs in → closes browser → cookies + Bearer tokens captured automatically. Stored to `~/.openweb/sessions/<site>/cookies.json` (plaintext cookie jar).

**MVP-3:** Encrypted auth store — AES-256-GCM encrypted, machine-ID keyed key derivation, `0o600` file permissions. Subdomain fallback (e.g., `spclient.wg.spotify.com` → `spotify.com`).

**Post-MVP:** Auto-refresh — OAuth refresh_token flow (no browser) + browser-based CSRF refresh + CAPTCHA detection (switch to visible mode).

Key design decisions:
- Single encrypted file keyed by domain (not one file per site)
- Subdomain fallback with opt-out (`isolatedAuth`)
- JWT `exp` parsing for proactive refresh (don't wait for 401)
- Mutex on handoff/refresh per domain (prevent concurrent auth flows)
- Cookie snapshot interval during handoff (2s) — browser may disconnect before final read

### Error Contract

Structured error JSON on stderr, non-zero exit code. Agents need structured errors to make decisions (retry? ask human? give up?).

```json
{
  "error": "execution_failed",
  "code": "SESSION_EXPIRED",
  "message": "Session cookies for google-flights are expired or invalid.",
  "action": "Run `openweb login google-flights` to re-authenticate.",
  "retriable": false
}
```

Error codes (minimal set):

| Code | Meaning | `retriable` |
|---|---|---|
| `EXECUTION_FAILED` | All escalation modes failed | `false` |
| `SESSION_EXPIRED` | Cookies invalid / 401 | `false` |
| `RATE_LIMITED` | Got 429, backed off, still failing | `true` |
| `FINGERPRINT_STALE` | Site changed, tools may be broken | `false` |
| `HUMAN_REQUIRED` | Human handoff needed | `false` |
| `TOOL_NOT_FOUND` | Unknown site or operation | `false` |
| `INVALID_PARAMS` | Parameters don't match schema | `false` |

Success: JSON response on stdout, exit code 0. Error: error JSON on stderr, exit code 1.

### CLI Architecture: Hybrid Per-Invocation + Background Daemon

The CLI itself is per-invocation (simple, stateless, scriptable). A background daemon manages browser sessions only:

- `openweb exec` is a per-invocation process that talks to the daemon via a local socket.
- The daemon manages a pool of browser contexts (one per site).
- The daemon auto-starts on first `exec` that needs browser context (any `session_http` or `browser_fetch` call).
- The daemon auto-exits after an idle timeout (5 minutes).
- `direct_http` calls bypass the daemon entirely — zero overhead for public API calls.

This gives the simplicity of per-invocation CLI with the performance of a warm browser session. The daemon is an implementation detail, invisible to the agent.

### Serving Interface: CLI-first, Agent-Agnostic

| Interface | Consumer | Priority |
|---|---|---|
| CLI (`openweb <site> exec`) | Any coding agent (Claude Code, Codex, Cursor, Copilot) | MVP |
| CLI (`openweb <site> <tool>`) | Any coding agent (spec navigation) | MVP |
| OpenAPI export | Human developers, API gateways | MVP+1 |
| MCP adapter (`openweb mcp-serve`) | Agents without shell access | Optional |

See [compiler-output-and-runtime.md](compiler-output-and-runtime.md) for the complete CLI command reference and design rationale.

### Self-Healing

**Passive detection only for MVP.** No cron, no daemon, no polling. The executor tracks consecutive failures per tool in `~/.openweb/state/<site>/health.json`:

```json
{
  "search_flights": { "consecutive_failures": 3, "last_failure": "2026-03-03T12:00:00Z", "last_error": "schema_mismatch" },
  "get_details": { "consecutive_failures": 0 }
}
```

**Detection → warning → re-compile flow:**

1. **Detect:** Response schema validation fails. Increment consecutive failure counter.
2. **Warn:** After 3 consecutive failures, append structured warning to stderr:
   ```json
   { "warning": "TOOL_DEGRADED", "tool": "search_flights", "failures": 3, "action": "Run `openweb google-flights heal search_flights`" }
   ```
   The agent sees this and can decide to run `openweb heal` or ask the user.
3. **Minimal fallback:** Escalate execution mode to complete the immediate task.
4. **Re-record:** `openweb <site> heal` runs Phase 1 for the failing flow only.
5. **Diff:** Compare new vs stored: endpoint changed? fields renamed? new required params?
6. **Patch:** Auto-update the OpenAPI spec operations.
7. **Test:** Run the tool's test suite.
8. **Publish policy:**
   - Read-only tool changes: auto-publish if tests pass.
   - Write operation tool changes: **require human approval** before publishing.

**Per-endpoint response schema tracking (post-MVP):** During Phase 4, snapshot each endpoint's response schema hash in `x-openweb.response_schema_hash`. During `openweb exec`, compare response structure against schema. On mismatch: log warning, increment failure counter. This is cheaper than full re-compilation and catches the most common drift (new fields, removed fields, type changes).

Consistent mode escalation triggers re-probing.
