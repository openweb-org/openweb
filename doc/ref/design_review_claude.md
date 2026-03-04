# Design Gap Analysis & Recommendations

> **Reviewer**: Claude (Opus 4)
> **Date**: 2026-03-03
> **Scope**: All 6 documents in `doc/final/`
> **Verdict**: Strategic framing is strong — compiler metaphor, escalation ladder, OpenAPI-as-canonical-format are well-reasoned. Main gap pattern: **high-level architecture is solid, but data contracts between pipeline phases and runtime components are underspecified.**

---

## Priority Summary

| Priority | Gaps | Why |
|---|---|---|
| **Must resolve before coding** | #6 (session lifecycle), #7 (page context), #13 (target site), #14 (Python vs Node) | Can't write Phase 1 without these |
| **Must spec before MVP-1** | #1 (C-HAR schema), #2 (test format), #3 (x-openweb schema), #8 (error contract) | Data contracts between pipeline phases |
| **Should address** | #4, #5, #10, #12, #16 | Reduce implementation ambiguity |
| **Can defer** | #11, #17, #18, #19, #20 | Post-MVP or naturally resolved during implementation |

---

## A. Missing Specifications (implementation-blocking)

### Gap #1: C-HAR format has no concrete schema

**Location**: `architecture-pipeline.md:29-89`

C-HAR is described as the "foundational data structure" but is only characterized conceptually. No JSON schema, no example file, no field definitions. An implementer reading the Phase 1 output spec ("C-HAR files, one per explored flow" at line 89) won't know what to produce. Questions unanswered:

- How are causality links represented (UI event → request)?
- One file per flow or per page?
- How are CDP initiator stacks serialized?

**Recommendation**: Define a concrete C-HAR JSON schema before Phase 1 implementation. Start minimal:

```jsonc
{
  "flow_id": "search-flights-001",
  "site": "google.com/travel/flights",
  "recorded_at": "2026-03-03T12:00:00Z",
  "events": [
    {
      "type": "ui_action",
      "timestamp_ms": 1000,
      "action": "click",
      "selector": "button.search-btn",       // optional, for debugging
      "triggered_requests": ["req-001"]       // causality link
    }
  ],
  "requests": [
    {
      "id": "req-001",
      "timestamp_ms": 1020,
      "method": "POST",
      "url": "https://www.google.com/travel/flights/api/search",
      "headers": { /* ... */ },
      "body": "{ ... }",
      "initiator": { /* raw CDP initiator object */ },
      "causality": "user_triggered",          // user_triggered | background | prefetch
      "triggered_by_event": 0,                // index into events[]
      "response": {
        "status": 200,
        "headers": { /* ... */ },
        "body": "{ ... }"
      }
    }
  ],
  "cookies_snapshot": { /* cookies at start and end of flow */ }
}
```

One file per flow. Let the schema evolve during Phase A — but start with something concrete.

---

### Gap #2: Test format unspecified

**Location**: `architecture-pipeline.md:279-284`, `skill-package-format.md:17`

`tests/search_flights.test.json` appears in package examples but there's no schema. What's the assertion model? How do tests handle dynamic values (timestamps, IDs)? How are parametric test inputs structured?

**Recommendation**: Define a minimal test case schema:

```jsonc
{
  "operation_id": "search_flights",
  "cases": [
    {
      "name": "basic_search",
      "input": {
        "origin": "SFO",
        "dest": "JFK",
        "date": "2026-04-01"
      },
      "assertions": {
        "status": 200,
        "response_schema_valid": true,       // validate against openapi.yaml response schema
        "response_contains": {
          "flights": { "type": "array", "min_length": 1 }
        }
      },
      "recorded_at": "2026-03-03T12:00:00Z"
    }
  ]
}
```

Key design choice: assert **schema conformance**, not exact values. Use `response_contains` for structural spot-checks (array is non-empty, required fields present). This handles dynamic values naturally.

---

### Gap #3: `x-openweb` extension has no formal schema

**Location**: `compiler-output-and-runtime.md:201-210`

The `x-openweb` extensions are described by example across multiple documents but never formally defined. Without a JSON Schema, the compiler and CLI can drift apart in what they expect.

**Recommendation**: Define a JSON Schema for `x-openweb` at both the `info` level and the operation level. Publish it in the repo as `schemas/x-openweb.schema.json`. This is ~50 lines and prevents a whole class of integration bugs. Example:

```jsonc
// operation-level x-openweb
{
  "type": "object",
  "properties": {
    "mode": { "enum": ["direct_http", "session_http", "browser_fetch"] },
    "human_handoff": { "type": "boolean", "default": false },
    "type": { "enum": ["rest", "graphql"], "default": "rest" },
    "session": {
      "type": "object",
      "properties": {
        "csrf": {
          "oneOf": [
            { "type": "string" },                    // inline JS expression
            { "type": "object",                      // file reference
              "properties": { "$ref_extractor": { "type": "string" } },
              "required": ["$ref_extractor"] }
          ]
        },
        "page_url": { "type": "string", "format": "uri" }  // see Gap #7
      }
    }
  },
  "required": ["mode"]
}
```

---

### Gap #4: Extractor script interface undefined

**Location**: `skill-package-format.md:16`, `compiler-output-and-runtime.md:258`

`extractors/csrf.js` is mentioned but:

- What's the module contract? (default export? named function?)
- Execution context: Node.js or browser `page.evaluate()`?
- How does `x-openweb.session.csrf` reference a file vs inline expression? The syntax distinction isn't specified.

**Recommendation**: Define the convention explicitly:

- **Inline** (simple): `x-openweb.session.csrf` is a string → evaluated as JS expression in `page.evaluate()` context.
- **File reference** (complex): `x-openweb.session.csrf` is `{ "$ref_extractor": "extractors/csrf.js" }`.
- **Module contract**: The extractor script exports an async function that receives the Playwright `page` object and returns a string (the token value):

```js
// extractors/csrf.js
export default async function(page) {
  // Complex multi-step extraction
  const meta = await page.$('meta[name="csrf-token"]');
  return meta ? await meta.getAttribute('content') : null;
}
```

The runtime decides context: inline expressions run in `page.evaluate()` (browser), file extractors run in Node.js with the `page` object (can use Playwright APIs).

---

### Gap #5: `manifest.json` dependency notation grammar

**Location**: `skill-package-format.md:65-68`

The example `"search_flights.flights[].offer_id": "get_flight_details.offer_id"` uses a string path notation but there's no grammar. How are nested objects, arrays of arrays, or conditional dependencies expressed?

**Recommendation**: Use JSONPath-subset notation with a simple formal grammar:

```
dependency_key   := operation_id "." json_path
json_path        := segment ("." segment)*
segment          := field_name | field_name "[]"
field_name       := [a-zA-Z_][a-zA-Z0-9_]*
```

This is intentionally limited. `[]` means "any element of the array." No filter expressions, no wildcards beyond `[]`. If a dependency can't be expressed in this grammar, it's too complex for the agent to follow automatically and should be described in natural language in the operation's `summary` instead. Keep the formal graph simple; let the LLM handle edge cases.

---

## B. Architectural Gaps

### Gap #6: Session lifecycle is hand-waved

**Location**: `skill-package-format.md:253-255`, `architecture-pipeline.md:296-334`

The CLI architecture diagram shows a "Session Manager (background daemon)" with "auto-start on first exec, auto-exit on idle" but the design doesn't address:

- How does the runtime obtain the user's session cookies? Does the user log in via a headed browser that openweb launches?
- How are sessions persisted between CLI invocations?
- What happens when a session expires mid-execution?
- Multiple sites needing different sessions simultaneously?

This is critical because `session_http` and `browser_fetch` modes both depend on it, and those cover ~60% of real sites per the heuristics.

**Recommendation**: Design a concrete session management model:

1. **Session creation**: `openweb login <site>` launches a headed browser. User logs in manually. openweb captures the cookie jar and stores it to `~/.openweb/sessions/<site>/cookies.json`. For sites that don't need auth, this step is skipped.
2. **Session usage**: The executor reads cookies from the stored jar. For `session_http`, attaches cookies to HTTP requests. For `browser_fetch`, launches a headless browser with the stored cookies.
3. **Session refresh**: If a request fails with 401/403 and the session was previously valid, prompt the user to `openweb login <site>` again. Optionally support cookie refresh via headless navigation to a known page.
4. **Multi-site**: One cookie jar per site, independent lifecycles, no cross-contamination.
5. **Idle timeout**: The background browser process (for `browser_fetch` mode) exits after 5 minutes of no `exec` calls. Restarted transparently on next call.

This is the minimum needed for MVP. Session rotation, proxy support, etc. can come later.

---

### Gap #7: Browser page context for `browser_fetch` mode

**Location**: `architecture-pipeline.md:328-333`

For `browser_fetch`, the executor runs `page.evaluate(fetch(...))`. But which page? The design never specifies:

- Which URL the browser should be navigated to before the fetch
- Whether the page state matters (e.g., must the user be on the search results page to call `get_details`?)
- This information isn't in `x-openweb` extensions

**Recommendation**: Add `page_url` to `x-openweb.session`:

```yaml
x-openweb:
  mode: browser_fetch
  session:
    page_url: "https://www.google.com/travel/flights"
    csrf: "document.querySelector('meta[name=csrf]').content"
```

The executor navigates to `page_url` (if not already there) before running `page.evaluate()`. For most sites, this is the site's homepage or the section homepage — the same-origin policy ensures `fetch()` works regardless of which page within the domain you're on.

For sites where page state matters (rare), the extractor script approach (Gap #4) can handle navigation as part of the extraction. But the default case — navigate to `page_url`, then `fetch()` — should cover 90%+ of scenarios.

---

### Gap #8: Error contract missing

**Location**: Not specified anywhere in the design.

No specification of CLI error output format. What does the agent see when:

- All escalation modes fail?
- Session expired?
- Rate limited?
- Site fingerprint stale?

Agents need structured error output to make decisions (retry? ask human? give up?).

**Recommendation**: Define a structured error JSON on stderr, with a non-zero exit code:

```jsonc
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

Success: JSON response on stdout, exit code 0. Error: error JSON on stderr, exit code 1. This is the simplest contract that lets agents handle failures programmatically.

---

### Gap #9: CLI daemon vs per-invocation is blocking, not optional

**Location**: `compiler-output-and-runtime.md:563`

Listed as "open question" but it directly determines the session management architecture, `browser_fetch` latency, and concurrency model.

**Recommendation**: **Hybrid approach.** The CLI itself is per-invocation (simple, stateless, scriptable). A background daemon manages browser sessions only:

- `openweb exec` is a per-invocation process that talks to the daemon via a local socket.
- The daemon manages a pool of browser contexts (one per site).
- The daemon auto-starts on first `exec` that needs browser context (any `session_http` or `browser_fetch` call).
- The daemon auto-exits after an idle timeout (e.g., 5 minutes).
- `direct_http` calls bypass the daemon entirely.

This gives the simplicity of per-invocation CLI with the performance of a warm browser session. The daemon is an implementation detail, invisible to the agent.

---

## C. Feasibility Concerns Insufficiently Addressed

### Gap #10: CDP causality mapping is fragile for modern SPAs

**Location**: `architecture-pipeline.md:38`

The design relies on `requestWillBeSent.initiator` for causality mapping. Modern frameworks heavily break this link:

- Request queuing/batching (React Query, SWR, TanStack Query)
- Service workers intercepting and re-fetching
- Framework fetch interceptors (axios, ky) adding stack frames
- Debounced user actions triggering delayed requests

**Recommendation**: Treat CDP `initiator` as a primary signal, not the only one. Add fallback heuristics:

1. **Temporal proximity**: If a request fires within 500ms of a UI event and no other UI event intervenes, assume causality. Configurable threshold.
2. **Page navigation**: Requests that fire immediately after `Page.navigate` or `Page.frameNavigated` are page-load requests — classify as background unless they match user-initiated navigation.
3. **Request URL pattern**: Requests to known telemetry/analytics domains (google-analytics, segment, sentry, etc.) are always background. Maintain a denylist.
4. **Initiator stack depth**: Deep stacks through framework internals (React, Angular) still ultimately trace to user code. Parse stack traces to find the outermost user-land frame.

Document the expected degradation: "Causality mapping is best-effort. Phase 2 clustering can work with imperfect causality — it just means more noise in the initial endpoint groups, which LLM-assisted classification can clean up."

---

### Gap #11: Protobuf handling gets 2 sentences for a hard problem

**Location**: `compiler-output-and-runtime.md:526`

The design says "executor handles protobuf serialization — this is a content-type handler" but protobuf detection, schema extraction from obfuscated JS, and binary-to-JSON mapping are each substantial challenges.

**Recommendation**: This is correctly deferred to MVP-3. But acknowledge the difficulty explicitly in `architecture-pipeline.md` and add a placeholder section:

- Detection: Content-Type `application/x-protobuf`, `application/grpc-web`, `application/octet-stream` with binary magic bytes.
- Schema extraction: May require intercepting the site's own protobuf deserialization functions via `page.evaluate()` rather than reverse-engineering the `.proto` definitions.
- Alternative approach: For MVP-3, consider recording the site's own JS deserialization and replaying it rather than building a standalone protobuf codec.

No detailed design needed now, but framing the difficulty prevents surprise later.

---

### Gap #12: LLM cost during compilation not estimated

**Location**: `architecture-pipeline.md:155-163`, `openweb-design.md:320`

The compiler uses Claude API for semantic annotation, parameter classification, and tool naming. No estimate of cost per site, no caching strategy, no fallback.

**Recommendation**: Add a rough cost model and caching strategy:

- **Estimate**: ~5-15 LLM calls per endpoint (parameter classification, description generation, dependency analysis). At ~1K tokens per call, a 10-endpoint site costs ~50-150K tokens ≈ $0.50-$2.00 with Claude Haiku, $3-$10 with Sonnet.
- **Caching**: Cache LLM outputs keyed by (endpoint URL pattern + request/response sample hash). If the same endpoint is re-compiled with similar traffic, reuse the cached classification.
- **Fallback**: Heuristic-only mode (no LLM) for users who want offline compilation. Lower quality but functional — parameter names come from JSON keys, descriptions are blank.
- **Batching**: Group multiple endpoints into single LLM calls where possible (e.g., "classify these 5 parameters" in one prompt instead of 5 separate calls).

---

## D. Unresolved Decisions Listed as "Open Questions"

### Gap #13: No MVP-1 target site chosen

**Location**: `openweb-design.md:257-258`

Phase A starts with "1 easy site" but doesn't commit. This is the very first implementation decision.

**Recommendation**: Pick one now. Criteria: public JSON API, no auth for reads, no anti-bot, stable (won't change during development). Candidates:

- **Open-Meteo** (open-meteo.com) — free weather API, clean REST, JSON responses, no auth, no rate limits for reasonable use. Well-documented (can validate compiler output against official docs).
- **JSONPlaceholder** (jsonplaceholder.typicode.com) — fake REST API, too simple (no real UI to record from).
- **Hacker News API** (hn.algolia.com) — real site with REST API, public, stable.

**My recommendation: Open-Meteo.** It has a real web UI with interactable elements (location search, date pickers, forecast type selectors) that trigger clean REST API calls. Difficulty level 1. Perfect for validating the full pipeline.

---

### Gap #14: browser-use (Python) vs Node.js stack

**Location**: `openweb-design.md:349`

The entire tech stack is Node.js but the recommended navigation agent (browser-use, 79k stars) is Python. This is blocking for Phase 1.

**Recommendation**: Three options, in order of preference:

1. **Write a minimal Node.js navigation agent.** For Phase 1, the navigation agent doesn't need browser-use's full sophistication — it needs to load a page, identify interactable elements from the accessibility tree, and exercise them. This is ~200-300 lines of Playwright + LLM code. Keep the stack uniform. Upgrade to a more capable agent later if needed.
2. **Use browser-use as a subprocess.** Launch Python `browser-use` as a child process, communicate via stdio/IPC. Adds Python as a runtime dependency but preserves the single Node.js process for everything else.
3. **Switch the whole stack to Python.** High cost (Playwright's Node.js API is the primary one, custom Playwright wrappers exist for Python but are less mature for CDP access).

Option 1 is the least-risk path for MVP. The navigation agent is the most replaceable part of the system — it just needs to exercise the site's UI. The compiler pipeline (clustering, schema inference, probing) is where the real complexity lives.

---

### Gap #15: mitmproxy2swagger integration strategy

**Location**: `openweb-design.md:352`

Build or reuse for clustering? Same Python vs Node.js tension.

**Recommendation**: **Don't integrate mitmproxy2swagger directly.** It's a Python CLI that reads HAR files and produces OpenAPI specs. The useful idea is the algorithm (URL pattern clustering), not the code. Reimplement the clustering logic in Node.js (~300-500 lines) — it's straightforward URL parsing and grouping. Our additions (causal filtering, parameter classification, semantic annotation) are the majority of Phase 2 anyway.

Evaluate mitmproxy2swagger's output on test data to validate our own clustering produces equivalent or better results. Use it as a benchmark, not a dependency.

---

## E. Minor Gaps / Could Be Deeper

### Gap #16: No user onboarding flow

**Location**: Not addressed in any document.

How does someone install openweb, set up prerequisites (Node.js, Playwright), and compile their first site?

**Recommendation**: Add a brief "Getting Started" section to `openweb-design.md` or a separate `quickstart.md` to clarify:

```
npm install -g openweb       # installs CLI + Playwright
openweb compile <url>        # records, analyzes, probes, generates
openweb install <site>       # writes SKILL.md to agent workspace
```

Playwright auto-installs browser binaries via `npx playwright install chromium`. This is enough for MVP — no separate doc needed, just clarify the happy path.

---

### Gap #17: No `x-openweb` spec versioning/migration strategy

**Location**: `skill-package-format.md:55`, `compiler-output-and-runtime.md:208`

`spec_version: "0.1.0"` exists but no upgrade path when the format evolves.

**Recommendation**: For MVP, version is informational only. Add a rule: "The CLI must handle any `spec_version` ≤ current. If it encounters a newer version, it prints a warning to upgrade the CLI." Formal migration tooling can wait until there's a second version to migrate from.

---

### Gap #18: Multi-step transaction failure / rollback

**Location**: `self-evolution.md:30-36`

The dependency graph handles sequencing, but if step 3 of 5 fails, is rollback the agent's responsibility?

**Recommendation**: Yes — explicitly state that rollback is the agent's responsibility. The runtime executes individual tools atomically. Multi-step orchestration and error recovery are LLM agent concerns. Document this as a design principle: "Each tool call is atomic. The runtime does not manage multi-step transactions. The agent uses the dependency graph to plan sequences and handles failures at each step."

---

### Gap #19: Write operation risk classification

**Location**: `openweb-design.md:249`

"High-risk writes require confirmation" but no classification criteria.

**Recommendation**: Simple heuristic for MVP:

- **Low-risk**: HTTP methods GET, HEAD, OPTIONS (read-only). No confirmation.
- **Medium-risk**: POST/PUT/PATCH that the user explicitly invoked. Confirm once per tool invocation.
- **High-risk**: Operations involving payment, account deletion, or irreversible state changes. Always confirm with details shown. Classification: keyword match on `operationId` and `summary` (contains "delete", "payment", "purchase", "cancel subscription", etc.) + LLM classification during compilation.

---

### Gap #20: Self-healing failure detection mechanism

**Location**: `architecture-pipeline.md:349-361`

"When a tool starts failing" — passive (agent reports) or active (periodic health checks)? The threshold "3+ times" has no time window.

**Recommendation**: **Passive detection only for MVP.** The executor tracks consecutive failures per tool in a local counter file. After 3 consecutive failures (within any time window), it appends a warning to stderr: `"warning: search_flights has failed 3 consecutive times. Run 'openweb <site> heal' to re-compile."` Active health checks (cron-based fingerprint polling) can be added post-MVP.

---

## Summary

The design is in good shape for its stage. The strategic layer is well-thought-out and the key bets (compiler > runtime, OpenAPI > custom format, CLI > MCP) are correct. The gaps above are mostly at the **data contract** and **session management** layers — things that become apparent when you try to write the first line of Phase 1 code. Resolving gaps #6, #7, #13, and #14 is the prerequisite for starting implementation.
