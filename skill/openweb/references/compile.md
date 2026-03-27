# Compile Process

How to review and curate an analysis report into a correct site package.

**Responsibility:** Correctness — is each operation spec correct? Coverage is `discover.md`'s job.

## When to Use

- After discover handoff — reviewing analysis.json and producing a site package
- Recompiling an existing site with new traffic
- Reviewing WS/AsyncAPI output alongside HTTP

## Process

### Overview

```
  Step 1: Review analysis report
       |
       v
  Step 2: Curate  <-----------+
       |                       |
       v                       |
  Step 3: Generate             |
       |                       |
       v                       |
  Step 4: Verify -- failures? -+
       |
       v  (all pass)
  Step 5: Write artifacts
```

### Step 1: Review Analysis Report

Read `~/.openweb/compile/<site>/analysis.json`. This is the single report from the Analyze phase, replacing the old split files. Focus on correctness — is the pipeline's reasoning sound?

#### 1a. Auth Candidates

> Knowledge: `references/knowledge/auth-patterns.md`

Review `authCandidates` (ranked by confidence):
- Does the top candidate match your expectation for this site?
- Check `evidence.matchedCookies`, `evidence.matchedEntries` / `totalEntries` coverage ratio
- If the site uses localStorage JWT or OAuth token exchange, is that reflected?
- If confidence is low: was the user logged in during capture? Are tracking cookies being mistaken for auth?

Decision: accept the top candidate, pick a different one, or note that auth needs manual configuration.

#### 1b. Clusters

> Knowledge: `references/knowledge/graphql-patterns.md`

Review `clusters`:
- Are request groupings correct? Each cluster should represent one distinct API operation.
- **GraphQL sites**: check for `graphql` metadata on clusters. A single path like `/graphql` should have multiple sub-clusters split by `operationName`, `queryId`, or `persistedQueryHash`. If all GraphQL requests collapsed into one cluster, sub-clustering failed.
- **Path normalization**: check `normalization` on clusters. Are `/users/123` and `/users/456` correctly collapsed to `/users/{id}`? Are different paths incorrectly merged?
- `sampleCount` anomalies: a cluster with 100+ samples likely needs investigation (GraphQL collapse, or a polling endpoint).

#### 1c. Extraction Signals

> Knowledge: `references/knowledge/extraction-patterns.md`

Review `extractionSignals`:
- Any SSR/DOM data worth turning into operations? (Next.js `__NEXT_DATA__`, embedded JSON, etc.)
- If the API is weak but SSR data is rich, extraction may be the better approach.

#### 1d. WebSocket Connections

> Knowledge: `references/knowledge/ws-patterns.md`

If `ws` is present in the report:
- Review connection URLs — is this a real data channel or just telemetry?
- Check `heartbeatCandidates` — interval and payload correct?
- Check `executableOperationCount` — are there meaningful WS operations?

### Step 2: Curate

Select and refine operations from the analysis. This is the core agent work.

#### 2a. Select Operations

For each cluster, decide: **include, exclude, or merge?**

Exclude:
- Analytics/tracking endpoints (`/collect`, `/beacon`, `/pixel`)
- CDN/static asset endpoints (`/static/`, `/_next/`)
- Monitoring/telemetry WebSocket connections
- Heartbeat-only WebSocket connections (ping/pong only)

Include:
- Clusters matching target intents
- Clusters providing useful data even if not originally targeted

Merge:
- Multiple clusters that represent the same logical operation (e.g., paginated variants)

#### 2b. Name and Describe

Review `suggestedOperationId` and `suggestedSummary` for each included cluster:
- Rename for clarity (e.g., `get_api_v1_users` -> `getUsers`)
- Summary should describe the user action, not the URL

#### 2c. Confirm Auth

Based on Step 1a review, confirm the auth bundle for the site:
- Accept the top candidate from `authCandidates`?
- Override with a different candidate?
- Manual auth configuration needed?

#### 2d. Permissions and Replay Safety

For each operation:
- `permission`: `read` (GET, GraphQL query), `write` (POST mutation, PUT, PATCH, DELETE), or `admin`
- `replaySafety`: `safe_read` (can be replayed for verification) or `unsafe_mutation` (skip during verify)
- GraphQL: queries are `read` + `safe_read`, mutations are `write` + `unsafe_mutation`

#### 2e. Review Examples for PII

Check example parameter values and request bodies in cluster data:
- Real usernames, emails, phone numbers, addresses? Replace with generic values.
- Auth tokens or session IDs in examples? Remove.
- PII is scrubbed during generation, but flag anything the scrubber might miss.

#### Extraction Complexity Rule

If an operation's extraction logic (the `expression` in openapi.yaml) exceeds ~5 lines, **extract it into an adapter file**:

```
src/sites/<site>/
  openapi.yaml          <- references adapter, no inline JS
  adapters/<site>.ts    <- complex DOM parsing logic lives here
```

In openapi.yaml, replace the inline expression with an adapter reference:
```yaml
x-openweb:
  adapter: ./adapters/<site>.ts
```

**Inline is OK for:** simple `ssr_next_data`, `page_global`, short `html_selector` (1-3 lines).
**Adapter is required for:** multi-line DOM queries, regex parsing, complex data transformation.

openapi.yaml should be readable as a spec, not a code dump.

### Step 3: Generate

Run the compile command to generate the site package from curated decisions:

```bash
openweb compile <site-url> --capture-dir <dir>
```

This produces:
- `openapi.yaml` — HTTP operations
- `asyncapi.yaml` — WebSocket operations (if WS traffic present)
- `manifest.json` — package metadata
- `tests/*.test.json` — test fixtures

### Step 4: Verify

Check `~/.openweb/compile/<site>/verify-report.json` for per-operation verification results.

Each operation has:
- `overall`: `pass`, `fail`, or `skipped`
- `authWorks`: whether authenticated requests succeeded
- `publicWorks`: whether unauthenticated requests succeeded
- `attempts[]`: per-attempt diagnostics with `mode`, `statusCode`, `reason`, `durationMs`

#### Decision Table for Failures

| reason | action |
|---|---|
| `auth_required` | Need login. Run `openweb login <site>`, restart browser, re-verify. |
| `client_error` (400/404) | Check path template and parameters in spec. Path normalization wrong? Missing required param? |
| `server_error` (5xx) | Upstream issue. Retry once; if persistent, note in DOC.md. |
| `timeout` | Retry. If persistent, mark operation as `needs_browser` transport. |
| `network_error` | Check connectivity. SSRF blocked? Wrong host? |
| `non_json_response` | Expected JSON but got HTML. Wrong endpoint? Bot detection redirect? |
| `missing_example` | No example params to build request. Add example values in curation. |
| `skipped_unsafe` | Expected for write operations. Not a failure. |
| `ssrf_blocked` | Internal/private IP blocked by safety check. Check the host. |

For failures: fix the spec or curation decisions, then return to Step 2.

#### WS Verification

If AsyncAPI operations are present:
- Can the WebSocket connect with the detected auth?
- Does the heartbeat interval match?
- Do subscribe operations receive expected event types?

### Step 5: Write Artifacts

When all operations pass verification (or failures are understood and documented):

- Finalize **DOC.md** (per `references/site-doc.md`):
  - Auth, transport, extraction, and known issues
  - Map operations to target intents
  - Write operation safety levels
- Append first **PROGRESS.md** entry
- Update cross-site knowledge only when the experience generalizes
  (per `references/update-knowledge.md`)

## Execution Model Decision

A compile may emit `openapi.yaml`, `asyncapi.yaml`, or both. Review each independently. A site package is ready only when its useful protocols are curated, not merely emitted.

### Does the data come from WebSocket?

Yes -> curate WS operations in Step 2 alongside HTTP.

### If HTTP/page data:

**Direct JSON replay works** (API returns JSON, no bot detection)?
-> Use `node` transport.

**Browser network stack required** (bot detection, TLS fingerprint, session binding)?
-> Use `page` transport.

**Page contains structured SSR/global/DOM data** and API is weak/noisy?
-> Use extraction (`ssr_next_data`, `page_global`, `html_selector`, `script_json`).

**Declarative extraction unreadable**, or site uses browser-internal logic?
-> Use adapter (`page.evaluate` with custom JS in `adapters/` directory).

### Anti-pattern: probing with curl/fetch

**NEVER** test endpoints with curl, wget, fetch, or any direct HTTP tool. This poisons IP reputation with bot detection systems and can block even real browser sessions on the same IP. See `discover.md` "Browser First" rule.

## Common False Positives

- **Tracking cookies as auth**: Cloudflare, GA, Meta pixel cookies trigger cookie_session detection. Check `authCandidates` evidence for tracking cookie names.
- **Analytics as operations**: `/collect`, `/beacon`, `/pixel` — should be excluded in curation (Step 2a).
- **Dashboard noise**: SaaS dashboards generate heavy noise from internal namespaces. Manual curation must filter these.
- **Heartbeat-only WS**: WebSocket connections that only carry ping/pong — not useful as operations.
- **4xx responses as operations**: 401/403/404 responses produce samples and may generate clusters. These are useful as auth signals but the operations may need auth to work. Cross-reference with `authCandidates`.

## Common False Negatives

- **Auth not detected**: User was not logged in, or unsupported auth pattern. Check `authCandidates` — if empty or low confidence, re-capture with login.
- **CSRF not detected**: Token embedded in JavaScript (not cookie/meta tag) — identify manually.
- **Operations missing**: Key pages not visited during capture — return to discover agent for targeted browsing.
- **Cross-domain API**: Site calls a different domain (e.g., chatgpt.com -> api.openai.com). Check `summary.byCategory.off_domain` — use `--allow-host` if needed.
- **GraphQL collision**: Multiple GraphQL operations collapsed into one cluster. Check `clusters` for missing `graphql` sub-cluster metadata. May need capture with more varied queries to improve discrimination.

## Related References

- `references/discover.md` — coverage responsibility (target intents, gap review)
- `references/site-doc.md` — DOC.md / PROGRESS.md template
- `references/update-knowledge.md` — when to write cross-site patterns
- `references/knowledge/archetypes/index.md` — per-archetype curation expectations
- `references/knowledge/auth-patterns.md` — auth primitive detection
- `references/knowledge/graphql-patterns.md` — GraphQL sub-clustering and curation
- `references/knowledge/extraction-patterns.md` — SSR/DOM extraction techniques
- `references/knowledge/ws-patterns.md` — WS connection/message patterns
- `references/knowledge/troubleshooting-patterns.md` — failure diagnosis patterns
