# Compiler Pipeline

> Record → Analyze → Classify → Emit: turning website observations into skill packages.
> Last updated: 2026-03-16 (commit: `dd2b17e`)

## Overview

The compiler observes a website's behavior and generates a skill package (OpenAPI spec + manifest + tests). It operates in 4 phases:

```
Phase 1: Capture    Record HTTP traffic, WebSocket frames, state, DOM
Phase 2: Analyze    Cluster requests, differentiate params, infer schemas
Phase 3: Classify   Detect L2 primitives, probe mode, assign risk tier
Phase 4: Emit       Generate openapi.yaml + manifest.json + tests/
```

Currently: Phase 1 is complete (M0), Phases 2-4 handle L1 emission with partial L2 classification.

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

## Phase 4: Emit

Generates the skill package from analyzed operations.

```typescript
async function generatePackage(input: GeneratePackageInput): Promise<string>
```

**Generates:**
1. `openapi.yaml` — OpenAPI 3.1 spec with x-openweb extensions
2. `manifest.json` — Package metadata
3. `tests/<operationId>.test.json` — Test cases from captured samples

**Risk tier derivation:**
- DELETE → `high`
- POST/PUT/PATCH → `medium`
- GET/HEAD/OPTIONS → `safe`

**x-openweb extension emission:**
- Server-level: mode, auth, CSRF (from ClassifyResult)
- Operation-level: permission, stable_id, signature_id, tool_version

-> See: `src/compiler/generator.ts`

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
openweb compile <url>

# Scripted recording + compile
openweb compile <url> --script ./scripts/record-instagram.ts

# Capture only (manual)
openweb capture start --cdp-endpoint http://localhost:9222
openweb capture stop

# Test compiled package
openweb <site> test
```

---

## File Structure

```
src/compiler/
├── recorder.ts         # HAR parsing + scripted recording spawn
├── generator.ts        # OpenAPI + manifest emission
└── analyzer/           # Analysis pipeline
    ├── cluster.ts      # Group requests by path template
    ├── filter.ts       # Remove non-API requests
    ├── differentiate.ts # Path params vs query params
    ├── schema.ts       # Response JSON Schema inference
    ├── annotate.ts     # Metadata attachment
    └── classify/       # L2 primitive detection
```

---

## Related Docs

- [browser-capture.md](browser-capture.md) — Phase 1 capture details
- [meta-spec.md](meta-spec.md) — Types used in emission
- [architecture.md](architecture.md) — Where compiler fits
- `src/compiler/generator.ts` — Emission implementation
