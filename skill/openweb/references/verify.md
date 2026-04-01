# Verify Process

How to verify a curated site package across runtime, spec, and documentation
dimensions.

## When to Use

- `compile.md` Step 4 — after curating the spec and writing docs
- Standalone re-verification of an existing site package
- After any site update (new operations, auth fix, transport change)

**Important:** Verification must be performed by an independent agent — not the
same agent that curated the spec and wrote docs. This separation ensures blind
spots in curation are caught.

## Dimensions

Verification covers three dimensions. All three must pass before proceeding to
install.

```
Verify
├── Runtime Verify — does the operation execute and return data?
├── Spec Verify — does the spec follow curation standards?
└── Doc Verify — does DOC.md follow the site-doc template?
```

---

## Runtime Verify

### Batch Verify

```bash
openweb verify <site>
openweb verify <site> --browser   # also verify page-transport ops (auto-starts browser)
```

For sites that use `transport: page`, use `--browser` — it auto-starts the managed
browser if not already running and verifies page-transport ops that would otherwise fail.

`openweb verify <site>` reports lifecycle statuses:

| Status | What it means | What to do |
|--------|---------------|------------|
| `PASS` | Works. Continue to runtime exec. | |
| `DRIFT` | Works but response shape changed. | Re-compile or update fixtures if intentional. Document if transient. |
| `auth_expired` | Login/session expired. | `openweb login <site>`, `openweb browser restart`, rerun verify. |
| `FAIL` | Execution failed. | Read detail line. Fix spec or environment and rerun. |
| `FAIL` (403 with cookies) | Most ops return 403 even with valid cookies. | Wrong CSRF — check `authCandidates[0].csrfOptions` in analysis.json. See `analysis-review.md` CSRF Troubleshooting. |

### Runtime Exec Exit Gate

Batch verify checks HTTP sanity. Runtime exec proves an agent can get usable data.

For each target intent, exec the best operation:

```bash
openweb <site> exec <operation> '{"param": "value"}'
```

**Exit criterion:** Each target intent has at least one operation that returns
real data — HTTP 2xx, valid JSON, non-empty response with expected fields.

If all pass → continue to next dimension.
If any fail → diagnose below.

Common issues at this stage:
- `needs_browser` → run `openweb browser start`
- `needs_login` → log in to the site in the managed browser
- Hangs → check if token cache is stale (restart browser)
- Empty response → the API may need different parameters

### Diagnose and Loop

When runtime exec fails, diagnose the root cause and fix the spec.
Do not re-capture unless the problem is missing traffic.

| Response | Likely cause | Fix |
|----------|-------------|-----|
| 403 | Wrong CSRF config, missing headers, expired session | Check CSRF cookie/header names. Check if CSRF scope excludes GET. Check for extra required headers. If cookies missing: `openweb login <site>` |
| 401 | Session expired | `openweb login <site>`, restart browser |
| 999 / bot block | Node transport hitting bot detection | Switch to `page` transport |
| 200 HTML (not JSON) | SSR page endpoint, not API | Remove op and use API equivalent, or add extraction config |
| 404 | Wrong path template | Fix path parameter normalization in spec |
| 400 | Bad param examples or missing required params | Update `exampleValue` fields in spec |
| 200 empty/wrong data | Wrong query variables or response schema | Check captured request params vs what you're sending |
| Timeout / hang | Stale token cache, browser not running | `openweb browser restart`, clear token cache |
| Redirect loop | Auth-gated endpoint, not logged in | Log in, or remove endpoint |

After fixing the spec, return to batch verify. If the fix requires more captured
traffic (missing endpoints, wrong API domain), return to `discover.md` Step 2
for re-capture.

> **When to stop iterating:**
> - After 2 fix-and-verify cycles with no progress, the issue is likely
>   missing traffic (return to `discover.md` Step 2) or a blocked site.
> - If bot detection blocks all transports and no workaround exists,
>   document the blocker in DOC.md Known Issues and tell the user.
> - If the only failing ops are non-target bonus operations, proceed to
>   install — document the failures in Known Issues.

### WS Verification

If AsyncAPI operations are present:
- Can the WebSocket connect with the detected auth?
- Does the heartbeat interval match?
- Do subscribe operations receive expected event types?

---

## Spec Verify

Check the curated spec against `spec-curation.md` standards. The verifier
should not have seen the curation decisions — review the spec fresh.

### Checklist

| Check | What to look for |
|-------|-----------------|
| **Noise removed** | No analytics, tracking, CDN, telemetry, heartbeat operations remain |
| **Anti-bot params removed** | No `dm_*`, `w_rid`, `x-bogus`, `__a/__d/__s`, `msToken` in param lists |
| **Operation naming** | camelCase, descriptive, verb+noun (`searchProducts` not `getApiV1Search`) |
| **Summaries** | Each operation has a summary with 3-5 key response fields |
| **Auth config** | `x-openweb.auth` matches site's actual auth pattern; CSRF present if needed. **If site has write ops, auth must not be removed even if reads work without it** — auth is site-level |
| **Transport** | Correct transport per bot-detection level; page-transport ops have page_url |
| **Permissions** | GET → read, mutations → write/delete, GraphQL queries via POST → read |
| **Response schemas** | No bare `type: object` for ops that return structured JSON (unless truly opaque) |
| **Examples** | No PII in parameter examples or fixtures; no auth tokens in examples |
| **Write ops** | Permission set, safety level documented, replay_safety = unsafe_mutation |
| **Extraction** | Complex expressions (>5 lines) extracted to adapter files |

### Merge integrity (if existing package)

If curation involved merging with an existing package (per `spec-curation.md`
Merge section):
- Existing write operations preserved
- Existing adapter references preserved
- Existing complex auth config preserved (unless explicitly replaced)
- No duplicate operations (same path + method)

---

## Doc Verify

Check DOC.md against the `site-doc.md` template.

### Checklist

| Check | What to look for |
|-------|-----------------|
| **Overview** | One-liner present with site archetype |
| **Workflows** | At least one multi-step workflow showing cross-operation data flow |
| **Operations table** | All operations listed with Intent, Key Input (← source), Key Output |
| **Data flow annotations** | Every non-trivial param has a `← source` annotation showing where to get it |
| **Entry points** | Operations with no input dependencies are marked as entry points |
| **Quick Start** | Copy-paste commands for common intents |
| **No spec duplication** | DOC.md does not repeat full param lists or response schemas from openapi.yaml |
| **Site Internals** | API Architecture, Auth, Transport, Known Issues present below divider |
| **Known Issues** | Verify failures, bot detection, rate limits documented |
| **PROGRESS.md** | Entry exists for this compile cycle |

### Cross-check with spec

- Every operation in openapi.yaml appears in the Operations table
- No phantom operations in DOC.md that don't exist in the spec
- Workflow steps reference real operationIds

---

## Related References

- `references/compile.md` — process doc that invokes this at Step 4
- `references/spec-curation.md` — spec standards verified against
- `references/site-doc.md` — doc template verified against
- `references/analysis-review.md` — analysis context for runtime issues
- `references/troubleshooting.md` — deep debugging when verify fails
