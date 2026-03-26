# Compiler Pipeline

> Record → Analyze → Classify → Probe → Emit: turning website observations into skill packages.
> Last updated: 2026-03-26 (M38)

## Overview

The compiler observes a website's behavior and generates skill packages (OpenAPI spec + AsyncAPI spec + manifest + tests). It operates in 6 phases:

```
Phase 1: Capture      Record HTTP traffic, WebSocket frames, state, DOM
Phase 2: Analyze      Cluster requests, differentiate params, infer schemas
Phase 3: Classify     Detect L2 primitives, assign risk tier
Phase 3b: WS Analyze  Cluster WS frames, classify channels, infer schemas (M35)
Phase 4: Probe        (opt-in) Validate classify heuristics with real requests
Phase 5: Emit         Generate openapi.yaml + asyncapi.yaml + manifest.json + tests/
Phase 6: Report       Output compile report (filtered.json, clusters.json, classify.json, probe.json, summary.txt)
```

-> See: `src/compiler/`

---

## Phase 1: Capture

Records raw website behavior via CDP.

-> See: [browser-capture.md](browser-capture.md) — full capture module docs

**Output:** Capture bundle (traffic.har + websocket_frames.jsonl + state_snapshots/ + dom_extractions/)

---

## Phase 2: Analyze

Transforms raw capture data into structured operation candidates.

```
HAR entries
    │
    ├── Filter      Remove non-API requests (static assets, analytics)
    ├── Cluster     Group by path template (e.g., /api/v1/users/{id})
    ├── Differentiate  Identify path params vs query params
    ├── Schema      Infer response JSON schema from samples
    └── Annotate    Add metadata (content types, status codes)
```

**Key module:** `src/compiler/analyzer/`

The analyzer pipeline:
1. **cluster** — Group HAR entries by normalized URL path
2. **filter** — Remove tracking/analytics/static asset requests
3. **differentiate** — Detect path parameters vs literal segments
4. **schema** — Infer JSON Schema from response samples
5. **annotate** — Attach metadata to each operation
6. **classify** — Detect L2 primitives from capture data

---

## Phase 3: Classify

Detects L2 primitives from capture correlations.

Currently detects:
- `cookie_session` auth (presence of session cookies)
- `cookie_to_header` CSRF (cookie value appearing in request header)

**Output:** `ClassifyResult` with detected auth, CSRF, and mode.

-> See: `src/compiler/analyzer/classify`

---

## Phase 3b: Probe (opt-in)

Validates classify heuristics by making real GET requests through an escalation ladder:

```
Step 1: node (no auth)  → fetch with Accept: application/json
  200 → transport=node, authRequired=false
  401/403 → Step 2

Step 2: node (with auth) → fetch with browser cookies
  200 → transport=node, authRequired=true
  fail → fallback to classify heuristic

Step 3: page (deferred) → browser_fetch via CDP
  Not yet implemented; falls back to classify
```

**Constraints:**
- Only probes GET operations (mutations are never replayed)
- Rate limited: 500ms between probes, max 30 probes per compile
- Per-probe timeout: 5s
- SSRF-validated before every outbound request

**Merge strategy:** Probe results override classify heuristics (ground truth). If probe fails, classify heuristic is preserved as fallback.

-> See: `src/compiler/prober.ts`

---

## Phase 4: Emit

Generates the skill package from analyzed operations.

**Generates:**
1. `openapi.yaml` — OpenAPI 3.1 spec with x-openweb extensions
2. `asyncapi.yaml` — AsyncAPI 3.0 spec for WebSocket channels (if WS frames captured)
3. `manifest.json` — Package metadata (includes `ws_count`)
4. `tests/<operationId>.test.json` — Test cases from captured samples

**Risk tier derivation:**
- DELETE → `high`
- POST/PUT/PATCH → `medium`
- GET/HEAD/OPTIONS → `safe`

**x-openweb extension emission:**
- Server-level: mode, auth, CSRF (from ClassifyResult)
- Operation-level: permission, stable_id, signature_id, tool_version

-> See: `src/compiler/generator/openapi.ts`, `src/compiler/generator/asyncapi.ts`, `src/compiler/generator/package.ts`

---

## Scripted Recording

The compiler can run scripted recordings for automated capture:

```bash
openweb compile <url> --script recording-script.ts
```

Spawns: `pnpm exec tsx {script} --out {outputDir}`

The script drives browser interactions while the capture module records.

-> See: `src/compiler/recorder.ts`

---

## Compilation Verification

After emission, the compiler verifies by:
1. Loading the generated spec
2. Calling each operation with example params
3. Validating the response against the inferred schema

```bash
openweb compile <url>
# → Generates skill package
# → Runs verification (replay + schema check)
```

---

## CLI Commands

```bash
# Interactive capture + compile
pnpm dev compile <url>

# Scripted recording + compile
pnpm dev compile <url> --script ./scripts/record-instagram.ts

# Compile with probing (validates classify heuristics via real requests)
pnpm dev compile <url> --probe
pnpm dev compile <url> --probe --cdp-endpoint http://localhost:9222

# Compile from existing capture directory (skip capture phase)
pnpm dev compile <url> --capture-dir ./captures/my-site

# Capture only (manual)
pnpm dev capture start --cdp-endpoint http://localhost:9222
pnpm dev capture stop

# Test compiled package
pnpm dev <site> test
```

---

## File Structure

```
src/compiler/
├── recorder.ts             # HAR parsing + scripted recording spawn
├── prober.ts               # Probe escalation ladder + merge
├── analyzer/               # HTTP analysis pipeline
│   ├── cluster.ts          # Group requests by path template
│   ├── filter.ts           # Remove non-API requests
│   ├── differentiate.ts    # Path params vs query params
│   ├── schema.ts           # Response JSON Schema inference
│   ├── annotate.ts         # Metadata attachment
│   └── classify/           # L2 primitive detection
├── ws-analyzer/            # WebSocket analysis pipeline (M35)
│   ├── ws-load.ts          # Load WS frames from capture
│   ├── ws-cluster.ts       # Cluster frames by channel/topic
│   ├── ws-classify.ts      # Classify WS message types
│   └── ws-schema.ts        # Infer message schemas
└── generator/              # Package emission (M36 split)
    ├── openapi.ts          # OpenAPI 3.1 spec generation
    ├── asyncapi.ts         # AsyncAPI 3.0 spec generation
    └── package.ts          # manifest.json + tests + bundle
```

---

## Related Docs

- [browser-capture.md](browser-capture.md) — Phase 1 capture details
- [meta-spec.md](meta-spec.md) — Types used in emission
- [architecture.md](architecture.md) — Where compiler fits
- `src/compiler/generator/` — Emission implementation
