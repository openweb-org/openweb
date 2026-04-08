# Verify

Verify a site package across runtime, spec, and documentation before install.

## When to Load

- After building the package and writing DOC.md (guide.md Step 8)
- Standalone re-verification of an existing site package
- After any site update (new operations, auth fix, transport change)

**Independent verifier:** Verification should be performed by a separate agent
from the one that curated the spec. This separation catches blind spots.

## Example File Format

Example fixtures at `examples/*.example.json` are used by verify and runtime exec:

```json
{
  "operation_id": "searchProducts",
  "cases": [{
    "input": { "k": "laptop" },
    "assertions": { "status": 200, "response_schema_valid": true }
  }]
}
```

Files without a `cases` array are silently skipped by verify. For adapter-only
packages where compile doesn't generate examples, create them manually.

---

## Three Dimensions

All three must pass before install.

```
Verify
├── Runtime  — does the operation execute and return data?
├── Spec     — does the spec follow curation standards?
└── Doc      — does DOC.md match the spec and follow template?
```

---

## Runtime Verify

### Batch Verify

```bash
openweb verify <site>
openweb verify <site> --browser              # include page-transport ops
openweb verify <site> --ops op1,op2          # only verify specific operations
openweb verify <site> --ops op1 --browser    # combine filters
```

Use `--browser` for sites with `transport: page` — it auto-starts the managed
browser and verifies page-transport ops that would otherwise fail.
Use `--ops` to debug individual operations without running the full suite.

#### Status Interpretation

| Status | Meaning | Action |
|--------|---------|--------|
| `PASS` | Works | Continue to runtime exec |
| `DRIFT` | Works but type change or required field missing detected | Advisory warning (exit 0). Review schema if persistent |
| `auth_expired` | Session expired | `openweb login <site>`, `openweb browser restart`, rerun |
| `FAIL` | Execution failed | Read detail line, fix spec or environment, rerun |
| `FAIL` (403 + cookies) | CSRF misconfiguration | Check `authCandidates[0].csrfOptions` in analysis.json |

### Runtime Exec

Batch verify checks HTTP sanity. Runtime exec proves an agent can get usable
data against the target intents identified during discovery.

Read the site's DOC.md to find target intents, then exec the best operation for
each:

```bash
openweb <site> exec <operation> '{"param": "value"}'
```

**Exit criterion:** Each target intent has at least one operation returning
real data — HTTP 2xx, valid JSON, non-empty response with expected fields.

If all pass → continue to Spec Verify.
If any fail → diagnose below.

### Diagnosis Table

| Response | Likely Cause | Fix |
|----------|-------------|-----|
| 403 | Wrong CSRF config, missing headers, expired session | Check CSRF cookie/header names. Check if CSRF scope excludes GET. If cookies missing: `openweb login <site>` |
| 401 | Session expired | `openweb login <site>`, restart browser |
| 999 / bot block | Node transport hitting bot detection | Switch to `transport: page` |
| 200 HTML (not JSON) | SSR page endpoint, not API | Remove op and use API equivalent, or add extraction config |
| 404 | Wrong path template | Fix path parameter normalization in spec |
| 400 | Bad param examples or missing required params | Update `exampleValue` fields |
| 200 empty/wrong data | Wrong query variables or response schema | Compare captured request params vs what you're sending |
| Timeout / hang | Stale token cache, browser not running | `openweb browser restart`, clear token cache |
| Redirect loop | Auth-gated endpoint, not logged in | Log in, or remove endpoint |

After fixing the spec, return to batch verify.

### Failure-Based Loop Targets

| Failure | Return to |
|---|---|
| 403 / 999 / bot block / redirect loop / wrong signing | Probe (Step 2) — re-discover transport |
| Missing operation / missing evidence / missing write-time token | Capture (Step 4) — gather more evidence |
| Schema, naming, doc, or merge-quality issue | Build Package (Step 7) — fix spec/doc |
| Auth expired | Login and rerun verify |
| 2 cycles with no progress on same failure | Stop — document in DOC.md Known Issues |
| Bot detection blocks all transports | Stop — document blocker, inform user |
| Only non-target bonus ops fail | Proceed to Install — document in Known Issues |

> **Node transport trust:** `node_candidate` from probe is provisional.
> Node transport is only trusted after verify passes under runtime conditions.
> If node-transport operations fail with 403/999/bot-block, switch to
> `transport: page` and re-verify.

### WS Verification

If AsyncAPI operations are present, verify:

| Check | What to verify |
|-------|---------------|
| **Connection** | WebSocket connects with the detected auth |
| **Heartbeat** | Interval matches spec config |
| **Subscribe** | Subscribe operations receive expected event types |
| **Message shape** | Incoming messages match declared schemas |

WS failures usually stem from auth or URL issues. Check the connection URL
template and auth header injection before re-capturing.

---

## Spec Verify

Review the curated spec fresh — the verifier should not have seen curation
decisions.

Curation standards are defined in `curate-operations.md`, `curate-runtime.md`,
and `curate-schemas.md`. This checklist verifies compliance without restating
those standards.

### Checklist

| Check | Pass criterion |
|-------|---------------|
| **No noise** | No analytics, tracking, CDN, telemetry, or heartbeat-only operations |
| **No anti-bot params** | No `dm_*`, `w_rid`, `x-bogus`, `__a/__d/__s`, `msToken` in param lists |
| **Naming** | camelCase verb+noun (`searchProducts`, not `getApiV1Search`) |
| **Summaries** | Each operation has a summary listing 3-5 key response fields |
| **Auth** | `x-openweb.auth` matches site's actual pattern; CSRF present if needed |
| **Transport** | Correct per bot-detection level; page-transport ops have `page_url` |
| **Permissions** | GET → read, mutations → write/delete, GraphQL queries via POST → read |
| **Schemas** | No bare `type: object` for ops returning structured JSON |
| **No PII** | No real user data in parameter examples or fixtures |
| **Write ops** | Permission set, safety level documented, `replay_safety = unsafe_mutation` |
| **Extraction** | Complex expressions (>5 lines) extracted to adapter files |

### Merge Integrity (existing packages only)

If curation merged with an existing package:

- Existing write operations preserved
- Existing adapter references preserved
- Existing auth config preserved (unless explicitly replaced)
- No duplicate operations (same path + method)

---

## Doc Verify

Review DOC.md against the template defined in `document.md`. The verifier
checks completeness and accuracy, not style.

### Checklist

| Check | Pass criterion |
|-------|---------------|
| **Overview** | One-liner with site archetype |
| **Workflows** | At least one multi-step workflow showing cross-operation data flow |
| **Operations table** | All operations listed with Intent, Key Input (← source), Key Output |
| **Data flow** | Every non-trivial param has a `← source` annotation |
| **Entry points** | Operations with no input dependencies marked |
| **Quick Start** | Copy-paste commands for common intents |
| **No spec duplication** | No full param lists or response schemas repeated from openapi.yaml |
| **Known Issues** | Verify failures, bot detection, rate limits documented |
| **PROGRESS.md** | File exists with at least one dated entry recording the session |

### Cross-Check with Spec

- Every operation in openapi.yaml appears in the Operations table
- No phantom operations in DOC.md that don't exist in the spec
- Workflow steps reference real operationIds

---

## Exit Criteria

All three dimensions must pass:

1. **Runtime** — Every target intent has at least one operation returning real
   data. Non-target failures documented in Known Issues.
2. **Spec** — Checklist passes. No noise, correct auth/transport/permissions.
3. **Doc** — DOC.md covers all operations, has workflows with data flow.
   PROGRESS.md exists with at least one dated entry.
   annotations, cross-checks clean against spec.

When all pass → proceed to install (guide.md Install step).

## Related Files

- `guide.md` — workflow that invokes this at Step 8 (Verify)
- `curate-operations.md` — spec standards: naming, noise, permissions
- `curate-runtime.md` — spec standards: auth, transport, extraction
- `curate-schemas.md` — spec standards: schemas, examples, PII
- `document.md` — DOC.md template and knowledge-update guidance
- `../references/troubleshooting.md` — deep debugging when verify loops fail
