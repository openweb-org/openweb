# Design Comments from Reference Analysis

> **Source**: Cross-analysis of 6 projects in `.reference/reverse-api/`
> **Date**: 2026-03-03
> **Purpose**: Concrete design changes for openweb, grounded in what reference projects prove works (or doesn't).
>
> **⚠ LICENSE WARNING**: This document references apitap (BSL 1.1) for internal analysis only. When incorporating these recommendations into `doc/todo/v2/` design specs, describe capabilities generically without naming apitap. Use phrases like "reference implementations show that..." or "prior art demonstrates...". Do NOT carry over apitap-specific naming conventions, config key structures, or directory layouts.

Each recommendation cites the reference project(s) that inform it and maps to a specific openweb pipeline phase or component.

---

## Phase 1: Explore and Record

### R1. Drop C-HAR — use standard HAR + separate UI action log
Qi Note:很好。

**Evidence**: 0 of 6 projects define a combined "UI + HTTP + causality" format.
- **apitap**: `CapturedExchange` (HTTP only) + `PageSnapshot` (DOM only) — separate artifacts.
- **unsurf**: `NetworkEvent` (HTTP) + `PathStep[]` (UI) — stored in different DB columns.
- **reverse-api-engineer**: `recording.har` (Playwright native) + `actions.json` (separate sidecar).
- **CaskMCP**: `HttpExchange` with `notes` dict for source-specific metadata — no UI events at all.

**Why C-HAR fails**: The design review (Gap #10) already noted CDP `requestWillBeSent.initiator` is unreliable for SPAs. Reference projects confirm this — none rely on initiator stacks for causality. They all infer causality post-hoc (temporal proximity, field-name matching) or simply don't bother.

**Proposed output for Phase 1**:

```
recording/
├── traffic.har            # Playwright record_har, zero custom code
├── ui_actions.jsonl       # One line per action: {timestamp, action, selector, value, url}
└── metadata.json          # flow_id, site, recorded_at, cookies_snapshot, exploration_stats
```

**Benefits**: Playwright's `record_har` is free, well-tested, and produces files that mitmproxy2swagger / har-to-openapi can consume directly. UI actions are a simple append-only log. Causality inference moves to Phase 2 where it belongs.

**Causality in Phase 2**: Use temporal proximity (request within 500ms of UI action, no intervening action) + URL-pattern clustering to group requests by triggering interaction. This is what apitap's `recentEndpoints` does implicitly.

---

### R2. Use real Chrome profile as the default browser mode
Qi Note:很好。
**Evidence**: reverse-api-engineer's strongest anti-detection strategy.

reverse-api-engineer offers two browser modes. The "real Chrome" mode copies the user's actual Chrome profile (cookies, history, fingerprint) and launches via `channel="chrome"`. This sidesteps bot detection entirely for authenticated sites — the browser IS the user's browser.

**Impact on openweb**: For MVP-1, this means:
1. `openweb compile <url>` launches the user's real Chrome (headed, with their session).
2. User logs in if needed (human handoff for auth — same as the design's current plan).
3. Navigation agent drives the browser; traffic is recorded via Playwright `record_har`.
4. No separate `openweb login` command needed for MVP-1.

This eliminates Gap #6 (session lifecycle) for MVP-1. Proper session management (`openweb login`, cookie jars, encrypted storage) can be built for MVP-2 when multiple sites need independent sessions.

---

### R3. Adopt apitap's blocklist for traffic filtering
Qi Note:很好，但别直接抄。

**Evidence**: apitap maintains a curated 40+ domain blocklist covering analytics (Google Analytics, Segment, Mixpanel, Amplitude, Hotjar, Heap, PostHog, Clarity, FullStory), ads (DoubleClick, Facebook, Criteo, Outbrain, Taboola), error tracking (Sentry, Datadog, New Relic, Rollbar, Bugsnag), social tracking, and customer engagement (Intercom, Zendesk, Drift, Crisp). Subdomain matching included.

unsurf has a smaller blocklist (GA, GTM, Facebook, DoubleClick, Hotjar, Sentry, Wikipedia).

**Impact on openweb**: Pre-filter traffic during Phase 1 capture. This reduces Phase 2 noise significantly. The design currently mentions "causal filtering" as the primary noise reduction — but a simple domain blocklist eliminates the majority of noise before any analysis.

Additional path-based noise filter (from apitap): skip `/monitoring`, `/telemetry`, `/track`, `/manifest.json`, `/_next/static/`.

Additional content-type filter: only keep `application/json`, `application/vnd.api+json`, `text/json`, `application/x-www-form-urlencoded` (for form submissions), `application/graphql+json`. Skip images, CSS, fonts, plain HTML (unless it's a navigation target).

---

## Phase 2: Analyze and Extract

### R4. Use quicktype for schema inference
Qi Note:很好。
**Evidence**: har-to-openapi uses `quicktype-core` and produces the best schemas of all 6 projects. Key advantages over hand-rolled inference:

| Feature | quicktype | mitmproxy2swagger's `value_to_schema` | unsurf's `SchemaInferrer` |
|---|---|---|---|
| Multi-sample aggregation | Yes (feeds all examples) | No (first-wins) | Yes (merges samples) |
| Union types | Yes | No | Yes (`anyOf`) |
| Array item inference | All elements | First element only | All elements |
| Format detection | Via JSON Schema | None | date-time, email, uri, uuid |
| Property optionality | All-optional (conservative) | N/A | Required if in all samples |

quicktype is a TypeScript library (`quicktype-core`), fits openweb's Node.js stack, and handles the structural inference problem completely. openweb's LLM pass can then focus purely on semantic annotation (field descriptions, parameter classification) rather than structural inference.

**Integration point**: Phase 2, Step C (Schema Induction). Replace the planned "custom + `json-schema-generator`" with quicktype. Use LLM only for the semantic layer on top.

---

### R5. Adopt CaskMCP's flow detection algorithm for the dependency graph
Qi Note:很好。但是这个可以先defer一下。算是个高级功能，尤其是LLM-assisted。
**Evidence**: CaskMCP's `FlowDetector` is the most concrete implementation of inter-endpoint dependency detection across all 6 projects. Algorithm:

1. For each source endpoint, extract response schema field names (top-level + array item fields, depth 5).
2. For each target endpoint, extract request parameter names (path, query, body).
3. **Exact name match** → confidence 0.9.
4. **Suffix match** (source `"id"` ↔ target `"product_id"`, source path contains `/products`) → confidence 0.6.
5. Filter generic fields: `type`, `status`, `state`, `created_at`, `count`, `total`, `page`, `limit`, `offset`.
6. Keep highest-confidence edge per (source, target) pair.
7. `find_sequences()` extracts linear chains from root nodes (no incoming edges), following highest-confidence edges greedily.

**Impact on openweb**: This replaces the underspecified "dependency graph" in Phase 2 Step D. The algorithm is purely structural (no LLM needed), runs in O(n²) over endpoints, and produces exactly the `dependencies` map that `manifest.json` needs.

**Enhancement for openweb**: Add LLM-assisted validation for low-confidence edges (0.6–0.7). Present them as "possible dependencies" in the compilation report. High-confidence edges (≥ 0.8) are auto-accepted.

Wire the output into `manifest.json.dependencies` and into tool descriptions: `"(Requires offer_id from search_flights)"` — matching CaskMCP's pattern of embedding dependency hints in descriptions.

---

### R6. URL normalization is sufficient with regex — don't over-invest
Qi Note:很好。
**Evidence**: All 6 projects use regex-based URL normalization. None use LLM for clustering. The patterns converge:

| Pattern | Replacement | Used by |
|---|---|---|
| UUID (RFC 4122) | `{id}` or `:id` | all 6 |
| Pure numeric (≥3 digits) | `{id}` | all 6 |
| Hex string (≥8 chars) | `{id}` or `{hash}` | unsurf, apitap |
| Base64 (≥16 chars) | `{id}` | unsurf |
| Date patterns | `{date}` | har-to-openapi |
| Boolean `true`/`false` | `{bool}` | har-to-openapi |

**Proposed regex set for openweb** (union of best patterns):

```javascript
const PARAM_PATTERNS = [
  { pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, name: 'id' },
  { pattern: /^\d{3,}$/, name: 'id' },           // 3+ digit numbers
  { pattern: /^[0-9a-f]{8,}$/i, name: 'hash' },  // hex strings ≥8 chars
  { pattern: /^[A-Za-z0-9+/=]{16,}$/, name: 'token' }, // base64 ≥16 chars
  { pattern: /^\d{4}-\d{2}-\d{2}/, name: 'date' }, // ISO date prefix
];
```

Special cases:
- **GraphQL**: cluster by `operationName` (apitap, CaskMCP) or `extensions.persistedQuery.sha256Hash` (openweb design already covers this).
- **Map-style dicts**: all-numeric or all-UUID keys → `additionalProperties` (mitmproxy2swagger's insight).

---

## Phase 3: Probe and Classify

### R7. Adopt apitap's replayability tier model
Qi Note:很好。不要用apitap的命名。就在我之前的设计语言里就好。看上去差别只是session_http分了两级？这个有必要吗？这个mode本身不就是所谓的replayability的标识吗？这个先别改的太复杂。

**Evidence**: apitap's green/yellow/orange/red classification maps cleanly to openweb's escalation ladder:

| apitap tier | Meaning | openweb mode |
|---|---|---|
| green | Public, verified 200, no auth | `direct_http` |
| yellow | Auth required, no signing/CSRF | `session_http` |
| orange | CSRF tokens or fragile state | `session_http` (with CSRF extractor) |
| red | Connection failed, anti-bot | `browser_fetch` |

**Impact on openweb**: Phase 3's probing output should be a `replayability` object on each operation, not just the `x-openweb.mode` string. This gives richer signal:

```yaml
x-openweb:
  mode: session_http          # cheapest working mode
  replayability:
    tier: yellow
    verified: true             # was this actually tested?
    signals:                   # evidence for the classification
      - "status-match"
      - "auth-required"
```

The `signals` array is debuggable and helps self-healing: if a green endpoint starts failing, the signals show what changed.

**Verification approach** (from apitap):
- GET endpoints: actually replay during Phase 3 probe, check status + response shape.
- Non-GET: heuristic only (header inspection for CSRF/auth). Don't probe write endpoints.

---

## Phase 4: Generate and Test

### R8. Adopt CaskMCP's three-level endpoint identity

**Evidence**: CaskMCP uses three identity levels for tracking endpoints across versions:

```
stable_id:     sha256(method + host + path)[:16]        — survives parameter changes
signature_id:  sha256(method + host + path + params)[:16] — changes on breaking changes
tool_version:  integer, incremented on breaking changes   — human-readable version
```

**Impact on openweb**: Currently `manifest.json` has only `fingerprint` (a whole-site hash). Per-endpoint identity enables:
1. **Granular drift detection**: know which specific endpoint changed, not just "something changed."
2. **Backward-compatible updates**: parameter additions don't change `stable_id`, so agents using the old tool name still work.
3. **Version tracking**: `tool_version` in the generated OpenAPI `x-openweb` tells agents when a tool's contract has changed.

Add to `x-openweb` per operation:

```yaml
x-openweb:
  stable_id: "a1b2c3d4e5f6g7h8"
  signature_id: "i9j0k1l2m3n4o5p6"
  tool_version: 1
```

---

### R9. Add deterministic risk classification

**Evidence**: CaskMCP's risk tier system is rule-based and effective:

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

**Impact on openweb**: The current design says "high-risk writes require confirmation" (Gap #19 in design review) but has no classification criteria. CaskMCP's keyword-based rules are a concrete, implementable answer.

Add `risk_tier` to `x-openweb`:

```yaml
x-openweb:
  mode: session_http
  risk_tier: medium        # safe | low | medium | high | critical
  human_handoff: false
```

`risk_tier` drives:
- Confirmation prompts: `high` and `critical` always confirm. `medium` confirms once per session.
- Rate limiting: `safe=120/min, low=60, medium=30, high=10, critical=5` (CaskMCP's defaults are reasonable).
- Self-healing publish policy: `safe`/`low` auto-publish; `medium`+ require human approval (aligns with existing design).

---

## Runtime

### R10. Adopt apitap's zero-dep replay for `direct_http` mode
Qi Note:很好。direct_http本来就是这么设计的啊。
**Evidence**: apitap's replay engine uses only Node.js stdlib `fetch()`. No Playwright, no Chrome, no extra installs. The entire replay path is ~200 lines: URL construction → SSRF check → auth injection → `fetch()` → contract diff → response.

**Impact on openweb**: The `direct_http` executor should be equally minimal. For MVP-1 (easy site, no auth, read-only), the executor is:

```javascript
// direct_http executor — ~30 lines
const url = buildUrl(operation, params);  // from OpenAPI path + params
const res = await fetch(url, { method, headers, body });
const json = await res.json();
validateSchema(json, operation.responses['200'].content['application/json'].schema);
return json;
```

No browser, no session manager, no daemon. The daemon/session-manager complexity is only needed for `session_http` and `browser_fetch` modes (MVP-2).

---

### R11. SSRF protection is mandatory for the executor
Qi Note: 没太看懂，但感觉很有必要。
**Evidence**: apitap implements multi-layer SSRF protection: hostname validation → DNS resolution → IP pinning (reject private CIDRs) → redirect validation. CaskMCP has similar `validate_network_target()`.

**Why it matters**: openweb's executor takes user-provided parameters and constructs HTTP requests. If a parameter is a URL or a path segment, a malicious or confused agent could craft requests to `localhost`, cloud metadata endpoints (`169.254.169.254`), or internal services.

**Minimum for MVP**:

```javascript
function validateTarget(url) {
  const parsed = new URL(url);
  // Reject non-HTTPS (except localhost for dev)
  if (parsed.protocol !== 'https:') throw new Error('HTTPS required');
  // Reject private IPs after DNS resolution
  const ips = await dns.resolve(parsed.hostname);
  for (const ip of ips) {
    if (isPrivate(ip)) throw new Error(`Private IP: ${ip}`);
  }
  // Reject known metadata endpoints
  if (parsed.hostname === '169.254.169.254') throw new Error('Metadata endpoint');
}
```

Apply on every `fetch()` call in the executor, including redirect targets.

---

### R12. Contract drift detection via response schema snapshots
Qi Note:很好。但是可以往后推一推，mvp不需要。
**Evidence**: apitap stores a `responseSchema` (5-level recursive type tree) on each endpoint at capture time. Every subsequent replay diffs actual vs. expected and returns `contractWarnings`. CaskMCP has a `DriftEngine` that compares endpoint sets across compilations.

**Impact on openweb**: The design mentions fingerprinting (JS bundle hash + endpoint set hash + response shape hash) but doesn't specify per-endpoint response schema tracking. Add:

1. During Phase 4, snapshot each endpoint's response schema in `x-openweb.response_schema_hash`.
2. During `openweb exec`, after successful response, compare response structure against schema.
3. On mismatch: log warning, increment consecutive-failure counter, suggest `openweb <site> heal` after 3 failures.

This is cheaper than full re-compilation and catches the most common drift (new fields, removed fields, type changes).

---

## Auth & Session

### R13. Auth progression: real Chrome → human handoff → encrypted store → auto-refresh

**Evidence**: apitap has the most complete auth implementation of all 6 projects. Its full lifecycle:

1. **Human handoff** (`requestAuth()`): opens visible Chromium, user logs in, closes browser → cookies + Bearer tokens + OAuth tokens captured automatically.
2. **Encrypted storage** (`AuthManager`): AES-256-GCM encrypted `auth.enc`, PBKDF2 key derivation (100K iterations, machine-ID keyed), `0o600` file permissions.
3. **Replay injection**: every `fetch()` reads stored auth → injects headers/cookies. Subdomain fallback (`spclient.wg.spotify.com` → `spotify.com`).
4. **Proactive expiry**: checks JWT `exp` claim + `expiresAt` timestamp (30s buffer) before each request.
5. **Auto-refresh** (two paths): OAuth token endpoint (no browser needed) → browser-based CSRF/nonce capture (headless or visible for CAPTCHA).

Key insight: **first-time login always requires human interaction** — this is inherent to the problem, not a gap. What matters is that everything after initial login is automatic.

reverse-api-engineer takes a different approach: use the user's real Chrome profile to inherit existing sessions, avoiding the auth problem entirely during capture.

**Progression for openweb**:

| Phase | Auth approach | What's needed |
|---|---|---|
| **MVP-1** | No auth (public site: Open-Meteo) | Nothing |
| **MVP-2 capture** | Real Chrome profile (R2) | User's existing login session inherited during `openweb compile` |
| **MVP-2 runtime** | `openweb login <site>` → human handoff → plaintext cookie jar | apitap's handoff pattern: open browser, show banner, capture on close. Store to `~/.openweb/sessions/<site>/cookies.json` |
| **MVP-3 runtime** | Encrypted auth store | Adopt apitap's `AuthManager`: AES-256-GCM, machine-ID keyed PBKDF2, subdomain fallback |
| **Post-MVP** | Auto-refresh | OAuth refresh_token flow (no browser) + browser-based CSRF refresh + CAPTCHA detection (switch to visible mode) |

**Key design decisions from apitap to adopt**:
- Single encrypted file keyed by domain (not one file per site)
- Subdomain fallback with opt-out (`isolatedAuth`)
- JWT `exp` parsing for proactive refresh (don't wait for 401)
- Mutex on handoff/refresh per domain (prevent concurrent auth flows)
- Cookie snapshot interval during handoff (2s) — browser may disconnect before final read

---

## GraphQL

### R14. First-class GraphQL support from Phase 1

**Evidence**: Both apitap and CaskMCP handle GraphQL explicitly.

**apitap**: Detects GraphQL by path (`/graphql`) + presence of `operationName`/`query` in request body. Deduplicates by operation name: endpoint ID becomes `post-graphql-GetPosts`. Variables are extracted as parameters.

**CaskMCP**: Per-operation tool splitting from `operationName`. Infers `query` vs `mutation` from document text or name heuristics. Stores the captured `query` string as `fixed_body` in the tool definition.

**Impact on openweb**: The design mentions GraphQL handling in Phase 2 Step A but doesn't specify the mechanics. Adopt:

1. **Detection**: request to `/graphql` (or similar) with `operationName` or `query` in body.
2. **Clustering key**: `POST + operationName` (not URL path, which is always `/graphql`).
3. **Parameter extraction**: GraphQL `variables` → tool parameters. `query` string → fixed template (stored in `x-openweb.graphql_query` or as a `const` in requestBody schema with `default` value).
4. **operationId**: `{query|mutation}_{OperationName}` in snake_case (e.g., `query_get_posts`, `mutation_create_post`).
5. **Type inference**: if operation text starts with `mutation` → write operation. Otherwise → read.

---

## Self-Healing

### R15. Passive detection with structured warnings, not active health checks

**Evidence**: unsurf's Heal pattern: retry → re-scout → verify. apitap's contract diff on every replay. CaskMCP's DriftEngine runs on-demand, not continuously.

No reference project implements active health checks (cron-based polling). All use passive detection: the tool fails, the failure is counted, a threshold triggers re-compilation.

**Impact on openweb**: Confirms the design review's recommendation (Gap #20): passive detection only for MVP. Executor tracks consecutive failures per tool in `~/.openweb/state/<site>/health.json`:

```json
{
  "search_flights": { "consecutive_failures": 3, "last_failure": "2026-03-03T12:00:00Z", "last_error": "schema_mismatch" },
  "get_details": { "consecutive_failures": 0 }
}
```

After 3 consecutive failures: append structured warning to stderr:

```json
{ "warning": "TOOL_DEGRADED", "tool": "search_flights", "failures": 3, "action": "Run `openweb google-flights heal search_flights`" }
```

The agent sees this and can decide to run `openweb heal` or ask the user. No cron, no daemon, no polling.

---

## Filtering & Noise Reduction

### R16. Three-layer filtering pipeline

**Evidence**: Synthesized from apitap (domain blocklist + path noise + content-type) and har-to-openapi (urlFilter callback + mimeTypes + standard header filtering).

Proposed filtering pipeline for Phase 1 and Phase 2:

```
Layer 1: Domain blocklist (capture-time, Phase 1)
  - 40+ analytics/ads/tracking/error-tracking domains (adopt apitap's list)
  - Subdomain matching: *.google-analytics.com, *.sentry.io, etc.

Layer 2: Content-type filter (capture-time, Phase 1)
  - Keep: application/json, application/vnd.api+json, text/json,
          application/x-www-form-urlencoded, application/graphql+json
  - Skip: images, CSS, fonts, HTML (unless navigation target)

Layer 3: Path noise filter (Phase 2)
  - Static: /monitoring, /telemetry, /track, /health, /ping, /manifest.json
  - Framework: /_next/static/*, /_next/data/*, /__vite_*, /hot-update.*
  - Status: only 2xx responses become tool candidates
```

This removes 60-80% of captured traffic before Phase 2 analysis begins, reducing LLM token costs and clustering noise.

---

## What NOT to Adopt

### Don't adopt CaskMCP's governance model for MVP
Qi Note:同意。
The lockfile/Ed25519/policy-engine/audit-trail model is well-engineered but solves a different problem (enterprise compliance). For openweb MVP, the write-operation risk classification (R9) + human confirmation prompt is sufficient. Governance can be layered on as an optional module post-MVP.

### Don't adopt apitap's custom SkillFile format
Qi Note:同意。
openweb's decision to use OpenAPI 3.1 + `x-openweb` extensions is correct. The SkillFile format is proprietary and has no tooling ecosystem. OpenAPI gives openweb free interop with Swagger UI, Postman, code generators, and any OpenAPI-aware tool.

### Don't adopt reverse-api-engineer's LLM-as-pipeline approach
Qi Note:同意。
Having the LLM read raw HAR and generate code works for one-off scripts but produces non-reproducible, non-testable output. openweb's deterministic pipeline (capture → cluster → infer → generate) with LLM only for semantic annotation is the right architecture.

### Don't adopt unsurf's Cloudflare-only deployment
Qi Note:同意。
The tight coupling to CF Puppeteer/D1/R2/Vectorize prevents local development and limits deployment options. openweb's local-first, file-system-based approach is correct for a CLI tool.

---

## Priority Matrix

| Priority | Recommendations | Phase |
|---|---|---|
| **Before coding** | R1 (drop C-HAR), R2 (real Chrome), R10 (zero-dep executor) | MVP-1 blocking |
| **During MVP-1** | R3 (blocklist), R4 (quicktype), R5 (flow detection), R6 (URL normalization), R16 (filtering) | Phase 2 implementation |
| **During MVP-1** | R7 (replayability tiers), R11 (SSRF protection), R15 (passive detection) | Phase 3-4 implementation |
| **MVP-2** | R8 (endpoint identity), R9 (risk classification), R12 (contract drift), R13 (human handoff + cookie store), R14 (GraphQL) | Requires second site |
| **MVP-3** | R13 (encrypted auth store, subdomain fallback, JWT proactive refresh) | Auth hardening |
| **Post-MVP** | R13 (OAuth auto-refresh, browser CSRF refresh, CAPTCHA handling), active health checks, governance layer | Incremental |
