# Reviewing the Analysis Report

How to review the analysis output and decide: continue to curation, re-capture, or stop.

## Conditional Step

Review only applies to families where compile ran. If compile was skipped
(extraction-only or adapter-only families), there is nothing to review — those
families proceed directly to Build Package (guide.md Step 7).

## Probe Matrix Cross-Check

Before diving into analysis output, re-read the probe matrix from
`DOC.md ## Internal: Probe Results`. Review compares compile output to probe
findings:
- Treat probe findings as the **classifier** (lane, transport hypothesis)
- Treat compile findings as **artifact evidence** (schemas, auth ranking, clusters)
- If compile output contradicts the probe-determined lane or transport, the
  family routes back to Probe (guide.md Step 2), not forward to Build

## Which File to Read

**Read `analysis-summary.json` first.** It is a compact (<100 KB) subset of the
full report containing `summary`, `clusters`, `authCandidates`, and
`extractionSignals` — everything needed for the review steps below. It omits
`samples` and `navigation` arrays, which are large and rarely needed.

Only fall back to `analysis.json` (the full stripped report) when you need
per-sample detail — e.g., inspecting individual request/response bodies,
debugging a specific cluster's member requests, or verifying raw header values.

## What to Read and What to Skip

| Section | Where | Action |
|---|---|---|
| `summary` | `analysis-summary.json` | **Read first** — health check (~10 lines) |
| `authCandidates` | `analysis-summary.json` | **Read** — auth review (~10-30 lines) |
| `clusters` | `analysis-summary.json` | **Read** — coverage mapping (~20-100 lines/cluster) |
| `extractionSignals` | `analysis-summary.json` | **Read if SSR suspected** (~5-20 lines) |
| `ws` | `analysis-summary.json` | **Read if WS expected** |
| `samples` | `analysis.json` only | **Skip unless needed** — every labeled request, huge |
| `navigation` | `analysis.json` only | **Skip** — page-level groups, debugging only |

## Review Order

1. Summary signals
2. Auth candidates
3. Clusters
4. Extraction signals
5. WebSocket analysis (if expected)
6. Coverage decision

---

## 1. Summary Signals

Read the first ~30 lines (covers `version` through `summary`):

- **`summary.byCategory.api`** — API request count. Zero or very low = capture
  missed target traffic.
- **`summary.byCategory.off_domain`** — if high, the API lives on a different
  domain. Re-compile using the API domain as the site URL.
- **`summary.clusterCount`** — candidate operations found.

## 2. Auth Candidates

> Before reading: check `knowledge/auth-routing.md` for expected auth type.

Search for `"authCandidates"` in `analysis-summary.json`. For the rank-1 candidate:

- **`auth.type`** — matches expectation from `knowledge/auth-routing.md`?
- **`confidence`** — >0.7 reliable; 0.3-0.7 suspect (cross-check with routing
  table); <0.3 no meaningful auth (expected for public APIs, investigate if
  login required).
- **`evidence.matchedCookies`** — real auth cookies or tracking cookies?
  Tracking cookies (`__cf_bm`, `_ga`, `__gads`, `datadome`) should NOT appear.
  If they're the only matched cookies, the candidate is a false positive —
  check lower-ranked candidates or confirm the site is public.
- **`csrf`** — social sites with write ops usually need it. Check `csrf.type`
  (`cookie_to_header` or `meta_tag`) and cookie/header names.
- **`evidence.notes`** — human-readable detection rationale.

Empty or all-zero-confidence = no auth detected. Expected for public APIs;
red flag for sites requiring login.

### CSRF Verification

Auto-detected CSRF may be wrong. Check the top-level `csrfOptions` array in
analysis-summary.json — each entry is a CsrfPrimitive scored by
`scoreCsrfMatch()` (auth-candidates.ts:228).

**False positives:** locale cookies (`lc-main=en_US` -> `x-li-lang`), preference
cookies — short values, not tokens.

**Real CSRF signals:** headers named `csrf-token`, `x-csrf-token`; cookies
named `csrftoken`, `_csrf`; values are long random strings (>10 chars).

**Override:** edit `openapi.yaml` directly after compile:
- Set `x-openweb-csrf` with the correct type, cookie, and header values

> Full auth/CSRF primitive details: `knowledge/auth-primitives.md`

## 3. Clusters

Search for `"clusters"` in `analysis-summary.json`.

### Mapping Target Intents

Map each target intent to a cluster. Missing cluster = not captured, return
to capture. Per cluster check:

- **`suggestedOperationId` / `suggestedSummary`** — detected operation
- **`method` + `pathTemplate`** — HTTP shape
- **`sampleCount`** — request count

### Path Normalization

`/users/123` and `/users/456` should normalize to `/users/{id}`. If paths
got incorrectly merged, `normalization.originalPaths` shows what was collapsed.

### GraphQL Clusters

> For details: `knowledge/graphql.md` (persisted queries, batching)

- `graphql.operationName` — each query should get its own cluster
- `graphql.discriminator` — split method (`operationName`, `queryId`,
  `persistedQueryHash`, or `queryShape`)
- High `sampleCount` (100+) on `/graphql` with NO sub-cluster metadata =
  all operations collapsed. Fix: capture with more varied UI interactions.

### Cluster Red Flags

- **4xx-only clusters** — auth-required endpoints or stale URLs; cross-ref
  with `authCandidates`
- **Very high `sampleCount`** (100+) — GraphQL collapse, polling endpoint,
  or unfiltered analytics (exclude during curation)
- **`parameters`** — check required flags and example values
- **`responseVariants`** — observed status codes and content types

Note clusters to exclude and names to change — applied during curation.

## 4. Extraction Signals

> Decision flow and pattern details: `knowledge/extraction.md`

Search for `"extractionSignals"`. Auto-detected types:

- **`ssr_next_data`** — Next.js `__NEXT_DATA__`. `estimatedSize` shows if
  real data or skeleton.
- **`script_json`** — `<script type="application/json">` blocks. `selector`
  and `id` locate the element.

Not auto-detected (check manually if suspected):
- `page_global` (`window.__INITIAL_STATE__`), `__NUXT__`, `html_selector`

**Extraction vs API replay:** weak API clusters + rich SSR data = prefer
extraction. Note for curation.

## 5. WebSocket Analysis

> Message types and curation signals: `knowledge/ws.md`

Search for `"ws"` at top level:

- `connections[].url` — data channel or telemetry?
- `connections[].executableOperationCount` — meaningful operations?
- `connections[].heartbeatCandidates` — interval and payload
- `connections[].operations[]` — patterns (`subscribe`, `stream`,
  `request_reply`, `publish`)

Heartbeat-only and presence/typing channels = noise, exclude.

## 6. Coverage Decision

### Gap Diagnosis

If target operations are missing:

| Symptom | Cause | Fix |
|---|---|---|
| No API calls for feature | SSR data | Check page source for `__NEXT_DATA__`, `window.__INITIAL_STATE__` |
| High `off_domain` count | Cross-origin API | Re-compile with API domain |
| All endpoints 401/403 | Not logged in | Log in via managed browser, re-capture |
| GraphQL mega-cluster | Ops collapsed | More varied queries during capture |
| Content after scroll only | Lazy loading | Scroll, click "load more" |
| Auth `confidence: 0`, `rejectedSignals` mentions no overlap | Capture was unauthenticated | Re-capture with login |
| CSRF missing | Token in JS, not cookie/meta | Find manually in dev tools, add to spec |

### Failure-Based Loop Targets

| Failure type | Route to | Rationale |
|---|---|---|
| Missing family coverage (target intent has no cluster) | Capture (Step 4) | Need more traffic evidence |
| Wrong target domain or evidence scope | Capture (Step 4) | Scoping problem |
| Compile output contradicts family lane or transport | Probe (Step 2) | Lane was wrong, re-discover |
| 2 capture iterations with no new clusters | Stop | Likely infeasible with current pipeline |
| Site flagged BLOCKED | Stop | Document in DOC.md Known Issues |
| Bot detection blocks all transports | Stop | Document and inform user |
| Usable draft with matched intents | Build Package (Step 7) | Proceed |

---

## Related Files

- `add-site/guide.md` — loads this at Review step
- `add-site/curate-operations.md` — used during Build Package (Step 7)
- `knowledge/auth-routing.md` — expected auth by site signal
- `knowledge/auth-primitives.md` — auth primitive config
- `knowledge/graphql.md` — GraphQL patterns
- `knowledge/extraction.md` — extraction decision flow
- `knowledge/ws.md` — WS patterns
