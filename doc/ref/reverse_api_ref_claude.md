# Reverse-API Reference Projects — Analysis

> **Reviewer**: Claude (Opus 4.6)
> **Date**: 2026-03-03
> **Scope**: 6 projects in `.reference/reverse-api/`
> **Purpose**: Understand prior art for openweb's pipeline design — what works, what doesn't, what to steal (ideas only).
>
> **⚠ LICENSE WARNING**: apitap is BSL 1.1. Do NOT copy code, naming conventions, config key structures, error messages, or directory layouts. Do NOT reference apitap by name in any `doc/final/` or public-facing documents. This reference doc is internal analysis only. When writing design specs, describe capabilities generically (e.g., "replayability tiers", "encrypted auth store") without attribution to apitap.

---

## Quick Comparison

| | apitap | unsurf | CaskMCP | reverse-api-engineer | mitmproxy2swagger | har-to-openapi |
|---|---|---|---|---|---|---|
| **Stars** | ~BSL 1.1 | ~8 | — | ~439 | ~9,200 | ~126 |
| **Language** | TypeScript | TypeScript (Effect) | Python | Python | Python | TypeScript |
| **Capture** | Playwright CDP listener | Cloudflare Puppeteer CDP | HAR/OTEL/Playwright/WebMCP/OpenAPI parsers | Playwright `record_har` | mitmproxy flows / HAR | HAR (library input) |
| **Output** | Custom SkillFile JSON | OpenAPI 3.1 + TS client | tools.json + policy.yaml + lockfile | Python/JS/TS scripts (LLM-generated) | OpenAPI 3.0 YAML | OpenAPI 3.0 object + YAML |
| **LLM usage** | None (infra for LLMs) | Optional (agent-scout only) | Optional (enrichment only) | Core (Claude generates all code) | None | None |
| **URL clustering** | Regex parameterization | Regex normalization | Regex + aggregator | N/A (LLM reads raw HAR) | Human-guided two-pass | Regex (opt-in) + quicktype |
| **Auth handling** | AES-256 encrypted store, JWT refresh, OAuth, CSRF, human handoff | None | Ed25519-signed lockfile approval | Stealth browser (real Chrome profile) | None | Header heuristic detection |
| **Governance** | Skill file signing (HMAC-SHA256) | None | Full lockfile + Ed25519 + policy engine + audit trail | None | None | None |
| **Replay** | Zero-dep `fetch()` engine | Direct `fetch()` (Worker) | httpx in MCP server | Generated scripts (user runs) | N/A (spec only) | N/A (spec only) |

---

## 1. apitap

> MCP server that captures internal APIs via Playwright CDP, generating reusable JSON "skill files" for direct API replay. Claims 20-100x token cost reduction vs browser automation.
>
> **License: BSL 1.1 (NOT open source).** Do NOT copy code. Ideas/architecture only.

### Architecture

```
Capture path:
  Browser (real/headless) → Playwright response listener → shouldCapture() filter
    → SkillGenerator.addExchange() → verifyEndpoints() → signSkillFile()
    → ~/.apitap/skills/<domain>.json

Replay path (zero-dep):
  Skill file → replayEndpoint() → SSRF check → auth injection → JWT expiry check
    → fetch() → contract diff → JSON response

Interface: MCP server (12 tools, stdio transport) + CLI
```

### Core Data Model

**CapturedExchange** — raw intercept:
```typescript
interface CapturedExchange {
  request: { url, method, headers, postData? };
  response: { status, headers, body, contentType };
  timestamp: string;
}
```

**SkillFile** — the canonical artifact:
```typescript
interface SkillFile {
  version: "1.2";
  domain: string;
  baseUrl: string;
  capturedAt: string;
  endpoints: SkillEndpoint[];
  metadata: { captureCount, filteredCount, toolVersion, browserCost? };
  provenance: 'self' | 'imported' | 'unsigned';
  signature?: string;       // HMAC-SHA256
  auth?: { refreshUrl?, browserMode?, captchaRisk?, ttlHint? };
}
```

**SkillEndpoint**:
```typescript
interface SkillEndpoint {
  id: string;                 // "get-events", "post-graphql-GetPosts"
  method, path, queryParams, headers;
  responseShape: { type, fields? };
  examples: { request, responsePreview };
  replayability?: { tier: 'green'|'yellow'|'orange'|'red'|'unknown', verified, signals };
  pagination?: { type: 'offset'|'cursor'|'page', paramName, limitParam };
  requestBody?: RequestBody;
  responseSchema?: SchemaNode; // 5-level recursive for contract drift
}
```

### Recording

- **Playwright CDP listener** — `page.on('response', ...)`, read-only observation. No proxy, no MITM.
- **Three browser modes**: `--attach` (existing Chrome CDP), `--launch` (new Chromium), Chrome extension.
- **Filtering pipeline**: domain → status 2xx → JSON content-type → blocklist (40+ analytics/ads/tracking domains) → path noise (`/monitoring`, `/_next/static/`).
- **Dedup key**: `method + cleanFrameworkPath(parameterizePath(path))`. GraphQL dedup: `POST graphql:OperationName`.
- **Idle detection**: 30s of no new unique endpoints → prompt user.

### Replayability Classification

| Tier | Meaning | How to replay |
|---|---|---|
| green | Public, verified 200 | Raw `fetch()` |
| yellow | Auth required, no signing | With stored credentials |
| orange | CSRF or fragile state | May need browser refresh |
| red | Connection failed (Cloudflare, etc.) | Full browser |

- GET endpoints: **live verification** during capture (replays without auth, checks status).
- Non-GET: **heuristic only** (header name matching for CSRF/auth, no actual replay).

### Auth Handling (most sophisticated of all 6 — full lifecycle)

**Credential acquisition** (three paths):
- **`--attach` mode**: connect to user's existing Chrome via CDP — inherits live session directly.
- **Chrome extension**: captures auth headers and cookies from user's real browser network responses.
- **Human handoff** (`requestAuth()`): opens visible Chromium, injects banner "Log in, then close this window", snapshots cookies every 2s, monitors network for Bearer tokens and OAuth token endpoint responses. User closing the browser = completion signal. Mutex prevents concurrent handoffs per domain.

**Detection** (during capture): known headers + Shannon entropy ≥ 3.5 bits/char + JWT prefix `eyJ` + OAuth token endpoint detection (`/token`, `/oauth/token`, `/oauth2/token`).

**Storage**: `~/.apitap/auth.enc` — single AES-256-GCM encrypted file, PBKDF2 (100K iterations, machine-ID + per-install random salt keyed), file permissions `0o600`. All credentials keyed by domain.

**Subdomain fallback**: `spclient.wg.spotify.com` → `wg.spotify.com` → `spotify.com` (opt-out via `isolatedAuth: true`).

**Replay-time injection**: every `fetch()` call checks stored auth → injects header/cookie → validates response.

**Proactive expiry**: checks `expiresAt` timestamp + JWT `exp` claim (with 30s buffer) before each request.

**Refresh** (two paths, tried in order):
1. **OAuth path** (no browser): if `oauthConfig` + refresh_token/client_credentials stored → calls token endpoint directly.
2. **Browser path** (for CSRF/nonce tokens): launches headless browser (visible if `captchaRisk`), restores cookies, navigates to `refreshUrl`, intercepts outgoing request bodies to capture fresh token values.

**CAPTCHA handling**: `detectCaptcha()` checks for Cloudflare challenge / reCAPTCHA / hCaptcha in page HTML. On detection, switches to visible browser mode with extended timeout for human solving.

**What this means**: apitap handles the full auth lifecycle — from initial human login through encrypted storage to automatic token refresh. The limitation is that **first-time login requires human interaction** (which is inherent to the problem, not a design gap). After initial login, session maintenance is fully automatic.

### What openweb should learn

1. **Zero-dep replay path** is the killer feature. Once a skill file exists, no Playwright needed — just stdlib `fetch()`. Token cost drops from 50-200K to 1-5K.
2. **Replayability tiers** are a clean abstraction for the escalation ladder.
3. **Full auth lifecycle** — human handoff → encrypted storage → proactive JWT refresh → OAuth refresh → browser-based CSRF refresh. This is the reference implementation for openweb's session management.
4. **Contract drift detection** via `responseSchema` snapshots — cheap, effective API change detection.
5. **GraphQL as first-class citizen** — deduplicate by operation name, extract variables.
6. **SSRF protection** is genuinely deep: hostname validation + DNS resolution + IP pinning + redirect validation.
7. **PII scrubbing** is automatic — emails, phones, SSNs, credit cards, JWTs stripped before write.

### Weaknesses

- No LLM — endpoint IDs are mechanical (`get-wp-json-wp-v2-posts`), no descriptions.
- No autonomous exploration — requires human browsing or LLM agent control via MCP.
- Custom SkillFile format, not OpenAPI — tooling ecosystem doesn't apply.
- Path parameterization is regex-only — can misclassify short numeric segments (`/v1`).
- No WebSocket/SSE support.
- Single-hop redirect following only.
- Auth storage is machine-locked (PBKDF2 keyed to machine-id) — cannot share across machines.

---

## 2. unsurf

> Web agent library with Scout/Worker/Heal pipeline. Generates OpenAPI 3.1 + TypeScript clients. Built on Effect-ts, deployed on Cloudflare Workers.

### Architecture

```
Scout (discover):
  Cloudflare Puppeteer → CDP intercept → NetworkEvent[]
    → URL normalization → schema inference → OpenAPI generation
    → persist to D1/R2

Worker (execute):
  Load ScoutedPath from D1 → pick best endpoint → direct fetch()

Heal (repair):
  Worker retry (exponential backoff) → re-Scout → verify new path

Optional: ScoutAgent (LLM-driven browser exploration, up to 10 steps)
```

Plus **Gallery** (per-instance FTS5 cache) and **Directory** (community registry, Vectorize embeddings for semantic search).

### Core Data Model

**NetworkEvent** (raw CDP capture):
```typescript
{ requestId, url, method, resourceType, requestHeaders, requestBody?,
  responseStatus, responseHeaders, responseBody?, timestamp }
```

**CapturedEndpoint**:
```typescript
{ id, siteId, method, pathPattern,    // normalized "/users/:id"
  requestSchema?, responseSchema?,    // inferred JSON Schema
  sampleCount, firstSeenAt, lastSeenAt }
```

**ScoutedPath** (UI steps + associated endpoints):
```typescript
{ id, siteId, task, steps: PathStep[], endpointIds: string[],
  status: "active"|"broken"|"healing", failCount, healCount }
```

**PathStep**: `{ action: "navigate"|"click"|"fill"|"submit"|"wait", selector?, value?, url? }`

**Fingerprint** (~50 LLM tokens, for agent discovery):
```typescript
{ domain, url, endpoints: number, capabilities: Capability[],
  methods: Record<string, number>, auth, confidence, specUrl }
```

### Recording

- **Cloudflare Puppeteer** with `setRequestInterception(true)`.
- **Filtering**: resource types `fetch|xhr|document|websocket|other` only. Hard skip: images, CSS, fonts, Google Analytics, GTM, Facebook, DoubleClick, Hotjar, Sentry, Wikipedia.
- **URL normalization**: UUID/numeric/base64(16+)/hex(8+) segments → `:id`.
- **Schema inference**: pure algorithmic — detects date-time/email/uri/uuid formats from string values, merges multiple samples (union of keys, `anyOf` for type conflicts).

### LLM Usage

Entirely optional, confined to `ScoutAgent`:
- Up to 10 steps: get page state → call LLM → execute action → repeat.
- **Model**: `claude-sonnet-4-20250514`, 512 max tokens.
- Uses Anthropic API directly (not MCP).
- LLM is NOT used for schema inference, OpenAPI generation, or URL normalization.

### What openweb should learn

1. **Effect-ts architecture** — typed errors, DI via services, test doubles for everything. The right model for reliable pipelines.
2. **Fingerprint concept** — 50-token summary for LLM agent discovery. Brilliant for reducing context costs.
3. **Heal pattern** — retry → re-scout → verify. A clean resilience primitive.
4. **Gallery + Directory** — per-instance cache + community registry separation.
5. **TypeScript client codegen** from OpenAPI — typed `fetch()` functions, no runtime deps.

### Weaknesses

- **Scout is single-page**: basic scout does one `navigate()` and captures page-load traffic only. No interaction.
- **No auth handling**: navigates unauthenticated. 401/403 sites fail silently.
- **Worker is simplistic**: picks one endpoint, no multi-step workflows, no CSRF/session handling.
- **Agent-scout is disconnected**: returns raw events, not persisted to D1, no OpenAPI generated.
- **Cloudflare-only deployment**: tightly coupled to CF Puppeteer/D1/R2.
- **No query parameter capture**: only path segments are normalized.

---

## 3. CaskMCP

> Governed MCP server with lockfile-based approval, fail-closed enforcement, and full audit trails. Focus is governance/security over API extraction.

### Architecture

```
Capture → Normalize → Compile → Review → Approve → Serve → Verify/Drift
   |           |          |          |          |         |          |
HAR/OTEL   aggregator  tools.json  cask diff  lockfile  MCP stdio  contracts
OpenAPI    flow_detect  policy.yaml risk report Ed25519   enforce    drift report
Browser    path_norm    contracts   plan engine caskmcp   audit JSONL evidence
WebMCP     tagger       baseline              .lock.yaml DecisionEng bundles

One-shot: `cask mint <url>` runs Capture → Normalize → Compile → Sync
```

### Core Data Model

**HttpExchange** (unified capture model):
```python
class HttpExchange(BaseModel):
    id: str;  url, method, host, path: str
    request_headers, response_headers: dict[str, str]
    request_body, response_body: str | None
    request_body_json, response_body_json: dict | list | None
    response_content_type: str | None
    timestamp: datetime | None;  duration_ms: float | None
    source: CaptureSource  # har, otel, playwright, proxy, manual, webmcp
    redacted_fields: list[str]
    notes: dict[str, Any]  # source-specific (trace_id, span_id for OTEL)
```

**Endpoint** (normalized, enriched):
```python
class Endpoint(BaseModel):
    stable_id: str          # sha256(method+host+path)[:16]
    signature_id: str       # sha256(method+host+path+params)[:16]
    tool_id: str            # human-friendly: "get_user"
    tool_version: int       # incremented on breaking changes
    parameters: list[Parameter]  # path, query, header, body, cookie
    request_body_schema, response_body_schema: dict | None
    auth_type: AuthType
    risk_tier: str          # safe, low, medium, high, critical
    is_state_changing, is_auth_related, has_pii: bool
```

**FlowGraph** (inferred inter-endpoint dependencies):
```python
class FlowEdge(BaseModel):
    source_id, target_id: str       # signature_ids
    linking_field: str              # "id", "product_id"
    confidence: float               # 0.6 (suffix match) – 0.9 (exact match)
```

**Lockfile** (governance):
```python
class ToolApproval(BaseModel):
    tool_id, signature_id, name, method, path, host: str
    risk_tier: str
    status: "pending" | "approved" | "rejected"
    approved_by: str | None
    approval_signature: str | None   # "ed25519:<key_id>:<base64url>"
    change_type: str | None          # "new" | "modified" | "risk_changed"
```

### Five Capture Parsers

| Parser | Input | Notable |
|---|---|---|
| HAR | `.har` JSON | Filters static assets, preflight, WebSocket, SSE |
| OTEL | OpenTelemetry JSON/NDJSON | Extracts traceId/spanId/parentSpanId into `notes` |
| OpenAPI | OpenAPI 3.x specs | Bootstraps tools from existing docs |
| Playwright | Live browser (headful/headless/scripted) | Saves/loads storage state for auth |
| WebMCP | W3C WebMCP draft (Feb 2026) | JS injection: `navigator.modelContext`, `__MCP_B_TOOLS__`, `<meta>` tags, `.well-known/mcp-tools.json` |

### Flow Detection

Pairwise analysis across all endpoints:
1. Extract response schema field names (depth 5) from source endpoint.
2. Extract request parameter names from target endpoint.
3. **Exact match** → confidence 0.9. **Suffix match** (response `"id"` ↔ request `"product_id"`, path contains `/products`) → 0.6.
4. Filter generic fields: `type`, `status`, `page`, `limit`, `offset`, `created_at`, etc.
5. Wired into tools.json as `depends_on` / `enables` + description hints: `"(Call get_repo first to obtain owner)"`.

### Risk Classification

| Condition | Tier |
|---|---|
| Auth-related path (`/login`, `/oauth`, `/token`) | critical |
| `admin`, `payment`, `billing`, `checkout` | critical |
| `delete`, `destroy`, `revoke`, `terminate` | high |
| HTTP DELETE | high |
| POST/PUT/PATCH + PII | high |
| POST/PUT/PATCH (no PII) | medium |
| GET + PII | low |
| Not first-party host | medium |
| Everything else | safe |

Rate limits per tier: safe=120/min, low=60, medium=30, high=10, critical=5.

### Governance Model (unique among all 6)

1. **`cask gate sync`** — diff tools.json against lockfile, mark new/modified as pending.
2. **`cask gate allow <tool_id>`** — approve with Ed25519 signature.
3. **`cask gate check`** — CI gate: exit 0 (all approved), exit 1 (pending/rejected), exit 2 (no lockfile).
4. **Runtime enforcement**: every tool call runs through `DecisionEngine.evaluate()`:
   - Resolve action → integrity check (SHA-256 digest) → lockfile approval → Ed25519 signature verify → toolset check → policy rules → state-change detection → confirmation gate.
   - 25+ stable `ReasonCode` enum values: `DENIED_NOT_APPROVED`, `DENIED_INTEGRITY_MISMATCH`, `DENIED_RATE_LIMITED`, etc.
5. **Audit**: every decision → JSONL entry with tool_id, request fingerprint, decision, reason_code, lockfile_digest.

### What openweb should learn

1. **`stable_id` + `signature_id` + `tool_version`** — three-level identity for endpoints. `stable_id` survives parameter changes, `signature_id` changes on breaking changes, `tool_version` increments. Good for drift detection.
2. **Flow detection algorithm** — simple, effective, no LLM needed. Field-name matching with confidence scoring.
3. **Risk classification** is rule-based and deterministic — correct for governance, doesn't need LLM.
4. **Multi-input capture normalization** — proves the value of a unified intermediate model (all 5 parsers → same `HttpExchange`).
5. **WebMCP capture** is forward-looking — sites will increasingly declare MCP tools natively.

### Weaknesses

- **Governance-heavy, capture-light**: the governance layer is overengineered for openweb's needs; the capture layer is thin.
- **OTEL capture is import-only**: no live OTLP collector. Bodies usually absent in OTEL spans.
- **No anti-bot handling**: httpx-based replay gets blocked by Cloudflare/Akamai.
- **Schema inference depends on sample diversity**: single capture → incomplete schemas.
- **Flow detection is structural, not semantic**: false edges possible (e.g., `user_id` from product response → user endpoint).
- **Confirmation is out-of-band only**: requires operator watching stderr.

---

## 4. reverse-api-engineer

> CLI tool using Playwright + Claude to capture HAR files and auto-generate production-ready API client scripts. LLM is the core — it reads raw HAR and writes all code.

### Architecture

```
User prompt → Mode selection → Browser (Playwright + HAR recording)
  → ~/.reverse-api/runs/har/{run_id}/recording.har
  → LLM reads HAR → generates api_client.py/js/ts + README
  → tests own code (up to 5 attempts) → writes to ./scripts/{name}/
```

**Four modes**: manual (user browses), engineer (re-process past HAR), agent (LLM drives browser), collector (web data scraping).

### Recording

- **Playwright `record_har_path`** — native HAR recording, not custom interception.
- **Two browser modes**:
  - **Real Chrome**: copies user's actual Chrome profile, launches via `channel="chrome"`. Strongest anti-detection.
  - **Stealth Chromium**: `playwright-stealth` + custom JS injection (patches `navigator.webdriver`, `navigator.plugins`, WebGL fingerprint, `window.chrome.runtime`, etc.).
- **ActionRecorder** (optional, `@codegen` mode): JS init script injects click/input/keydown listeners, transmits via `console.log('__ACTION__' + JSON.stringify(...))`. Priority selector: `data-testid` > short `id` > `name` > `aria-label` > text > tag+class.

### LLM Usage (core, not optional)

- **Dual-SDK**: Claude Code CLI subprocess (`claude-agent-sdk`) or OpenCode local server (port 4096).
- **Master prompt**: provides `<har_path>`, instructs LLM to read HAR → identify patterns → generate client → test → iterate (up to 5 attempts).
- **Agent mode prompt**: 4 phases — BROWSE (MCP browser tools) → MONITOR (watch traffic) → CAPTURE (save HAR) → REVERSE ENGINEER (generate code).
- **Three agent providers**: `auto` (MCP + `rae-playwright-mcp`), `browser-use` (patched git commit), `stagehand`.
- **AskUserQuestion**: Claude can pause mid-task and present interactive prompts to the human.

### Anti-Detection (most thorough of all 6)

Five layers:
1. Real Chrome binary + user's actual profile (cookies, history, fingerprint).
2. `playwright-stealth` library evasions.
3. Custom `STEALTH_JS`: `navigator.webdriver` → `undefined`, fake plugins, WebGL spoofing (Apple M1 Pro), `chrome.app` hiding, Shadow DOM `closed` → `open`.
4. Launch flags: `--disable-blink-features=AutomationControlled`, remove `--enable-automation`.
5. Realistic context: random UA from Chrome 130/131 list, locale, timezone, screen size.

### Output

- **Python**: `api_client.py` using `requests`, class-based, docstrings, error handling. Falls back to Playwright CDP if bot-detected.
- **JavaScript**: ESM, native `fetch` or `axios`, JSDoc.
- **TypeScript**: strict typing, interfaces, `package.json`.
- **OpenAPI docs** (`@docs` tag): full OpenAPI 3.0 spec from HAR.

### What openweb should learn

1. **Real Chrome as first-class browser** — using the user's actual profile is genuinely hard to detect.
2. **Dual-SDK architecture** — clean `BaseEngineer` ABC makes LLM backend swappable.
3. **Self-testing loop** — LLM tests its own generated code, iterates up to 5 times.
4. **Tag system** (`@record-only`, `@codegen`, `@id`, `@docs`) — composable control without complex flags.
5. **Real-time file sync** via watchdog — copies generated files to CWD as they appear.

### Weaknesses

- **LLM is the entire pipeline** — no deterministic extraction. Quality varies per run. High token cost.
- **No structured intermediate format** — raw HAR → LLM → scripts. No reusable artifact.
- **No HAR filtering/preprocessing** — full HAR (with images, fonts, analytics) goes to LLM.
- **Produces imperative scripts, not declarative tools** — not reusable as agent tools.
- **No auth management** — if tokens expire, generated scripts break.
- **`browser-use` pinned to specific git commit** — fragile dependency.

---

## 5. mitmproxy2swagger

> Converts mitmproxy flow captures or HAR exports to OpenAPI 3.0 specs. Two-pass workflow with human-guided path selection. The most established project (~9,200 stars).

### Architecture

```
Pass 1 (discovery):
  Read all traffic → filter by --api-prefix → propose path templates
    → write to YAML with "ignore:" prefix in x-path-templates section
  [Human edits YAML: removes "ignore:" from desired paths]

Pass 2 (schema generation):
  Read same traffic → match against activated templates
    → generate full OpenAPI path items (params, request body, response schema)
    → write completed spec
```

### URL "Clustering" (human-guided)

Not automatic. After pass 1:
- URLs are sorted alphabetically, each with `ignore:` prefix.
- For numeric segments matching `--param-regex` (default `[0-9]+`), a parameterized variant is proposed: both `ignore:/users/{id}` and `ignore:/users/42` are added.
- **Human chooses** which to activate. Templates higher in the list take precedence (first match wins).
- `path_to_regex()` compiles templates to Python regex: `/users/{id}` → `^/users/(?P<id>[^/]+)$`.

### Schema Inference (simple)

Single-pass recursive type reflection:
```python
def value_to_schema(value):
    int/float → {"type": "number"}
    str → {"type": "string"}
    list → {"type": "array", "items": value_to_schema(value[0])}  # first element only!
    dict with all-numeric/UUID keys → {"type": "object", "additionalProperties": ...}
    dict → {"type": "object", "properties": {key: value_to_schema(v) for k,v}}
    None → {"type": "object", "nullable": True}
```

- Only first array element inspected.
- First-observed traffic wins per endpoint (no merge across requests).
- Supports JSON, MessagePack, and URL-encoded form bodies.

### Input Formats

| Format | Reader |
|---|---|
| mitmproxy binary flows | `FlowReader` → `MitmproxyFlowWrapper` |
| HAR JSON | `json_stream` (streaming) → `HarFlowWrapper` |

Both wrapped behind common interface: `get_url()`, `get_method()`, `get_request_body()`, `get_response_body()`, etc.

Auto-detection: heuristic scoring (printable bytes, JSON markers, binary magic).

### What openweb should learn

1. **`x-path-templates` as human review mechanism** — clever for quality control. The two-pass model ensures garbage doesn't reach the spec.
2. **Incremental merge** — running multiple times on different captures safely extends the same YAML (`set_key_if_not_exists`). Manual edits preserved.
3. **Map detection** — all-numeric or all-UUID dict keys → `additionalProperties` instead of fixed properties. Correct handling of `{"123": {...}, "456": {...}}` patterns.
4. **MessagePack support** — unusual, handles non-JSON APIs.

### Weaknesses

- **Schema inference is primitive**: first-element-only arrays, first-observed-only endpoints, no union types.
- **No automatic clustering**: human must review all paths manually. Tedious with 100+ endpoints.
- **Two-pass workflow is not automatable** — requires manual YAML editing between runs.
- **No security/auth detection**.
- **No OpenAPI 3.1 support**.
- **No multi-domain support** — single `--api-prefix` per run.

---

## 6. har-to-openapi

> TypeScript library to programmatically convert HAR files to OpenAPI 3.0 specs. Fully automated, no CLI.

### Architecture

Pure library, two entry points:
```typescript
generateSpec(har: Har, config?: Config): Promise<HarToOpenAPISpec>   // first domain
generateSpecs(har: Har, config?: Config): Promise<HarToOpenAPISpec[]> // one per domain
```

Single-pass, fully automated: group by hostname → process entries → generate schemas → return.

### URL Parameterization (opt-in)

```typescript
parameterizeUrl(path, minLengthForNumericPath = 3):
  UUID segment → {uuid}, type "string", pattern + min/maxLength
  Date segment → {date}, type "string", format "date"
  Numeric (>3 digits) → {id}, type "integer"
  "true"/"false" → {bool}, type "boolean"
```

Off by default — requires `attemptToParameterizeUrl: true`.

### Schema Inference (quicktype — most powerful of all 6)

Uses **quicktype-core**:
- **Multi-sample**: all observed examples for an endpoint fed to quicktype together.
- Produces full JSON Schema → converted to OpenAPI Schema via `@openapi-contrib/json-schema-to-openapi-schema`.
- `allPropertiesOptional: true` — all fields optional (conservative).
- `$ref` dereferencing — output is self-contained.
- Handles: JSON, multipart/form-data, URL-encoded, binary → `{type: "string", format: "binary"}`.

### Security Detection

Scans request headers for 18 known auth header names (`authorization`, `x-api-key`, `x-csrf-token`, etc.) + custom `securityHeaders`. Cookies → separate `apiKey` schemes with `in: "cookie"`. Populates `components.securitySchemes`.

### Filtering

| Option | Effect |
|---|---|
| `urlFilter` | string/regex/async callback (access to full HAR entry, including `_resourceType`) |
| `mimeTypes` | Only entries with matching response content type |
| `filterStandardHeaders` | Remove ~130 standard HTTP headers (default: true) |
| `dropPathsWithoutSuccessfulResponse` | Remove paths without any 2xx response |
| `relaxedMethods` | Include non-standard HTTP methods |
| `forceAllRequestsInSameSpec` | Skip domain grouping |

### What openweb should learn

1. **quicktype for schema inference** — dramatically better than hand-rolled `value_to_schema`. Multi-sample aggregation is the right approach.
2. **Multi-domain support** — automatic grouping by hostname, one spec per domain. Simple and correct.
3. **`urlFilter` callback with HAR entry access** — allows filtering by `_resourceType` (xhr/fetch), making noise reduction trivial.
4. **Security scheme detection** — automatic `components.securitySchemes` from header heuristics.
5. **`relaxedContentTypeJsonParse`** — default true, handles APIs that mislabel their JSON. Pragmatic.

### Weaknesses

- **HAR-only input** — no mitmproxy, no live capture.
- **No CLI** — library only, must write code to use.
- **No persistence/merge** — each call is stateless. Can't incrementally build a spec from multiple captures.
- **`attemptToParameterizeUrl` off by default** — without it, `/users/1` and `/users/2` are separate paths.
- **All properties optional** — too loose for strict consumers.
- **No OpenAPI 3.1 support**.

---

## Cross-Cutting Patterns & Lessons for openweb

### 1. Nobody uses C-HAR

No project defines a combined "UI events + HTTP traffic + causality links" format. The pattern across all 6 is:
- **HTTP traffic**: standard HAR or minimal custom struct (10-15 fields).
- **UI events**: separate sidecar (when tracked at all).
- **Causality**: inferred post-hoc (temporal proximity, field-name matching), never recorded at capture time.

**Recommendation**: drop C-HAR. Use standard HAR (Playwright `record_har`) + separate UI action log.

### 2. Schema inference quality varies enormously

| Project | Approach | Quality |
|---|---|---|
| har-to-openapi | quicktype (multi-sample) | Best |
| CaskMCP | Pydantic + aggregator (multi-sample) | Good |
| unsurf | Custom recursive (multi-sample merge) | Decent |
| mitmproxy2swagger | Custom recursive (first-sample-only) | Poor |
| apitap | `responseShape` (field names only, 5-level) | Minimal |
| reverse-api-engineer | LLM reads raw HAR | Variable |

**Recommendation**: use quicktype or equivalent for schema inference. Multi-sample aggregation is critical.

### 3. URL normalization is universally regex-based

All projects use the same pattern: UUID → `{id}`, numeric → `{id}`, hex → `{hash}`. None use LLM for URL clustering. The heuristics are good enough for 95% of APIs.

**Recommendation**: implement regex-based normalization first. LLM-assisted clustering can be a Phase 2 enhancement.

### 4. Auth handling is the hardest problem

| Project | Auth sophistication |
|---|---|
| apitap | Full lifecycle: human handoff → AES-256 encrypted store → JWT proactive refresh → OAuth token refresh → browser-based CSRF refresh → CAPTCHA detection. First login requires human; everything after is automatic. |
| CaskMCP | Governance: Ed25519 approval, but thin capture-time auth |
| reverse-api-engineer | Stealth: real Chrome profile avoids needing auth |
| unsurf | None |
| mitmproxy2swagger | None |
| har-to-openapi | Detection only |

**Recommendation**: apitap's auth architecture is the gold standard and should be openweb's target model. For MVP-1, follow reverse-api-engineer (real Chrome profile to inherit sessions). For MVP-2, implement apitap-style `openweb login` (human handoff → encrypted cookie/token store). For post-MVP, add OAuth refresh and browser-based CSRF refresh.

### 5. The replay spectrum

```
Zero-dep fetch()    ←→    Headless browser    ←→    Full browser
   (apitap, unsurf)      (openweb browser_fetch)    (reverse-api-engineer)

Fastest, cheapest         Middle ground              Slowest, most compatible
Works with auth           Handles same-origin fetch  Handles everything
(apitap injects stored    (page.evaluate context)    (real browser session)
 tokens into fetch)
```

**Recommendation**: openweb's escalation ladder (`direct_http` → `session_http` → `browser_fetch`) is the right design. apitap's replayability tiers provide the classification signal for which level to use.

### 6. Governance is orthogonal

CaskMCP's lockfile/signing/audit model is genuinely strong but independent of the capture/compile pipeline. It could be layered on top of openweb's output as a separate concern.

**Recommendation**: don't build governance into the core pipeline. Output clean OpenAPI + `x-openweb` extensions. A CaskMCP-style governance layer can be added later as a wrapper.
