# Compiler Pipeline

> Capture -> Analyze -> Curate -> Generate -> Verify: turning website observations into skill packages.
> Last updated: 2026-03-28 (pipeline v2 session)

## Overview

The compiler observes a website's behavior and generates skill packages (OpenAPI spec + AsyncAPI spec + manifest + tests). It operates in 5 phases:

```
Phase 1: Capture      Record HTTP traffic, WebSocket frames, state, DOM
Phase 2: Analyze      Label, normalize, cluster, infer schemas, detect auth
Phase 3: Curate       Apply decisions, scrub PII, produce compile plan
Phase 4: Generate     Emit openapi.yaml + asyncapi.yaml + manifest.json + examples/
Phase 5: Verify       Replay safe reads via lifecycle verify (full executor)
```

-> See: `src/compiler/`

---

## Phase 1: Capture

Records raw website behavior via CDP. **No content-based filtering at capture time** — all requests are recorded with full metadata. Response bodies > 1 MB are omitted (metadata preserved).

-> See: [browser-capture.md](browser-capture.md) — full capture module docs

**Output:** Capture bundle (traffic.har + websocket_frames.jsonl + state_snapshots/ + dom_extractions/)

---

## Phase 2: Analyze

Transforms raw capture data into a single `AnalysisReport`. Orchestrated by `analyzeCapture()`.

```
HAR entries
    |
    +-- Extract       Parse HAR -> RecordedRequestSample with SampleResponse (json|text|empty)
    +-- Label         Classify each sample: api | static | tracking | off_domain
    +-- Normalize     Detect path params (numeric, uuid, hex, learned) -> path templates
    +-- Cluster       Group api samples by (method, host, normalizedPathTemplate)
    +-- GraphQL       Sub-cluster GraphQL endpoints by operationName/queryId/persistedHash
    +-- Differentiate Identify query params vs path params per cluster
    +-- Schema        Infer response JSON schemas with enum/format detection (schema-v2)
    +-- Example       Select PII-safe example values (schema-derived > frequent observed > fallback)
    +-- Auth          Bundle ranked auth candidates with evidence and confidence scores
    +-- CSRF          Surface all detected CSRF mechanisms (cookie_to_header, meta_tag)
    +-- Classify      Detect extraction signals (SSR, script_json, page_global patterns)
    +-- WS Analyze    Cluster WS frames, classify channels, infer message schemas
    +-- Navigation    Group samples by page-level referer for context
```

**Key modules:**
- `src/compiler/analyzer/labeler.ts` — sample categorization (replaces filter.ts for classification)
- `src/compiler/analyzer/path-normalize.ts` — structural + cross-sample path normalization
- `src/compiler/analyzer/graphql-cluster.ts` — GraphQL sub-clustering by discriminator
- `src/compiler/analyzer/auth-candidates.ts` — ranked auth detection with evidence
- `src/compiler/analyzer/schema-v2.ts` — schema inference with enum/format/size controls
- `src/compiler/analyzer/example-select.ts` — tiered example value selection with PII scrub
- `src/compiler/analyzer/classify.ts` — extraction signal detection (ssr_next_data, script_json, page_global)
- `src/compiler/analyzer/analyze.ts` — orchestrator producing AnalysisReport

**Labeler behavior (replaces v1 filter):**
- Blocked hosts/paths loaded from `src/lib/config/*.json` (config files, not hardcoded)
- Static content-types and file extensions classified as `static`
- Off-domain requests classified as `off_domain` (not silently dropped)
- Cross-domain API hosts included via `--allow-host` flag (e.g., `chatgpt.com` → `api.openai.com`)
- All status codes pass through (4xx = auth signal, not rejected)
- Every sample produces a `LabeledSample` — nothing is dropped

**Auth candidate ranking:** `localStorage_jwt` (rank 1) > `exchange_chain` (rank 2) > `cookie_session` (rank 3). Each candidate bundles auth + CSRF + signing with confidence score and evidence trail. All detected CSRF mechanisms also surfaced via `csrfOptions` on the report for agent override.

**Example value selection:** Tiered strategy replaces naive first-observed — schema-derived (enum/format/type) > most frequent observed value (PII-scrubbed) > generic fallback.

**Output:** `AnalysisReport` — persisted as `analysis-summary.json` (no samples/navigation), `analysis.json` (stripped bodies), `analysis-full.json` (complete)

---

## Phase 3: Curate

Transforms `AnalysisReport` + `CurationDecisionSet` into a `CuratedCompilePlan`.

**What it does:**
1. Selects auth candidate (top-ranked by default, or agent-specified)
2. Selects CSRF mechanism (top-ranked by default, or agent-specified via `csrfType`)
3. Excludes unwanted clusters
3. Applies operation overrides (operationId, summary, permission, replaySafety)
4. Scrubs PII from example values (tokens, emails, phone numbers, cookies)
5. Derives permission and replaySafety defaults per operation

**PII scrubbing** (`src/compiler/curation/scrub.ts`):
- Sensitive keys (password, secret, token, apikey) -> `<REDACTED>`
- Cookie values -> `<REDACTED_COOKIE>`
- JWT-like tokens -> `<REDACTED_TOKEN>`
- Emails -> `user@example.com`, phone numbers -> `+1-555-0100`

**Output:** `CuratedCompilePlan` consumed by Generate

-> See: `src/compiler/curation/apply-curation.ts`, `src/compiler/curation/scrub.ts`

---

## Phase 4: Generate

Consumes `CuratedCompilePlan` and emits the skill package.

**Generates:**
1. `openapi.yaml` — OpenAPI 3.1 spec with x-openweb extensions
2. `asyncapi.yaml` — AsyncAPI 3.0 spec for WebSocket channels (if WS frames captured)
3. `manifest.json` — Package metadata (spec_version 2.0)
4. `examples/<operationId>.example.json` — Example params from scrubbed captures (used by `--example`)

**Key behaviors:**
- Response variants: multiple status codes and content types per operation
- OperationId deduplication (appends `_2`, `_3` on collision)
- Per-operation server override when host differs from primary
- Request body schema emission for POST/PUT/PATCH
- Extraction signals emitted at info-level x-openweb

**x-openweb extension emission:**
- Info-level: spec_version, compiled_at, requires_auth, extraction_signals
- Server-level: transport, auth, CSRF, signing (from CuratedSiteContext)
- Operation-level: permission, build.stable_id, build.tool_version

-> See: `src/compiler/generator/generate-v2.ts`

---

## Phase 5: Verify

Compile-time verify uses the same `verifySite()` as the lifecycle health check — full executor with all transports, auth resolvers, and fingerprinting.

```
For each operation:
  resolveReplaySafety(example file → x-openweb.permission → HTTP method)
    unsafe_mutation -> skip
    safe_read -> executeOperation() via full executor
      auth resolvers (token cache → browser CDP → fail)
      transport routing (node / page / browser-fetch)
      fingerprint comparison against stored hashes

WS operations -> verified via live connection (connect, send, wait for response)
```

**ReplaySafety resolution** (3-level chain):
1. `replay_safety` field in `.example.json` (written by generator)
2. `x-openweb.permission` in `openapi.yaml` (`read` → safe_read, else → unsafe_mutation)
3. HTTP method fallback (`get`/`head` → safe_read, else → unsafe_mutation)

**Output:** `SiteVerifyResult` with per-operation `OperationVerifyResult` (PASS/DRIFT/FAIL)

-> See: `src/lifecycle/verify.ts`

---

## Scripted Recording

The compiler can run scripted recordings for automated capture:

```bash
openweb compile <url> --script recording-script.ts
```

Spawns: `pnpm exec tsx {script} --out {outputDir}`

The script drives browser interactions while the capture module records.
Child process is killed after 120s (`TIMEOUT.recording`, configurable via
`"recordingTimeout"` in `~/.openweb/config.json`).

-> See: `src/compiler/recorder.ts`, `skill/openweb/references/capture-guide.md`

---

## Report Format

All compile artifacts are written to `$OPENWEB_HOME/compile/<site>/`:

| File | Content | When |
|------|---------|------|
| `analysis-summary.json` | AnalysisReport without samples/navigation (agent-first) | Always |
| `analysis.json` | AnalysisReport with response bodies stripped | Always |
| `analysis-full.json` | Complete AnalysisReport with all data | Always |
| `verify-report.json` | VerifyReport with per-attempt diagnostics | When verify runs |
| `summary.txt` | One-line summary: pass/skip(write)/skip(page)/fail breakdown | Always |

---

## CLI Commands

```bash
# Scripted recording + compile
pnpm dev compile <url> --script ./scripts/record-site.ts

# Compile with cross-domain API support
pnpm dev compile <url> --allow-host api.openai.com

# Compile from existing capture directory (skip capture phase)
pnpm dev compile <url> --capture-dir ./captures/my-site

# Test compiled package
pnpm dev <site> test
```

---

## File Structure

```
src/compiler/
+-- types.ts                # Core types (RecordedRequestSample, SampleResponse, etc.)
+-- types-v2.ts             # Pipeline v2 type definitions (all 5-phase contracts)
+-- recorder.ts             # HAR parsing + scripted recording spawn
+-- analyzer/               # Phase 2: Analyze
|   +-- analyze.ts          # Orchestrator: analyzeCapture() -> AnalysisReport
|   +-- labeler.ts          # Sample categorization (api/static/tracking/off_domain)
|   +-- path-normalize.ts   # Structural + cross-sample path normalization
|   +-- graphql-cluster.ts  # GraphQL sub-clustering by discriminator
|   +-- auth-candidates.ts  # Ranked auth bundling with evidence + CSRF options
|   +-- schema-v2.ts        # Schema inference with enum/format/size controls
|   +-- example-select.ts   # Tiered example value selection with PII scrub
|   +-- cluster.ts          # Group requests by path template
|   +-- differentiate.ts    # Path params vs query params
|   +-- annotate.ts         # operationId + summary generation
|   +-- classify.ts         # Extraction signal detection (ssr_next_data, script_json, page_global)
|   +-- auth-detect.ts      # Auth primitive detection helpers
|   +-- csrf-detect.ts      # CSRF primitive detection helpers
|   +-- signing-detect.ts   # Signing primitive detection helpers
+-- curation/               # Phase 3: Curate
|   +-- apply-curation.ts   # AnalysisReport + decisions -> CuratedCompilePlan
|   +-- scrub.ts            # PII scrubbing for example values
+-- generator/              # Phase 4: Generate
|   +-- generate-v2.ts      # CuratedCompilePlan -> skill package (OpenAPI + AsyncAPI)
+-- ws-analyzer/            # WebSocket analysis (integrated into Phase 2)
    +-- ws-load.ts          # Load WS frames from capture
    +-- ws-cluster.ts       # Cluster frames by channel/topic
    +-- ws-classify.ts      # Classify WS message types
    +-- ws-schema.ts        # Infer message schemas
```

**Config files:** `src/lib/config/` — blocked-domains.json, blocked-paths.json, tracking-cookies.json, static-extensions.json

---

## Related Docs

- [browser-capture.md](browser-capture.md) — Phase 1 capture details
- [meta-spec.md](meta-spec.md) — Types used in emission
- [architecture.md](architecture.md) — Where compiler fits
- [security.md](security.md) — SSRF validation in verify
