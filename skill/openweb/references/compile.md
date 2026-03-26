# Compile Process

How to review and curate compiled output into a correct site package.

**Responsibility:** Correctness review — is the generated spec correct? Coverage is discover.md's job.

## When to Use

- After `openweb compile` — reviewing generated spec
- Recompiling an existing site with new traffic
- Reviewing WS/AsyncAPI output alongside HTTP

## Process

### Step 1: Compile

```bash
openweb compile <site-url> [--capture-dir <dir>] [--probe]
```

Read the compile summary: samples captured/filtered, operations generated, auth primitives detected, hints.

### Step 2: Review Compile Report

Check the compile-report for the code pipeline's reasoning:

- **`summary.txt`** — operationCount, auth detected, transport chosen
- **`clusters.json`** — are request groupings correct? Were GraphQL queries merged properly?
- **`classify.json`** — auth/CSRF confidence levels (high/medium/low). Low confidence needs careful review.
- **`probe.json`** — which ops verified, which failed? (if `--probe` was used)

Report location: `~/.openweb/compile/<site>/`

### Step 3: Curate (Track A — HTTP/OpenAPI)

Review the generated `openapi.yaml`:

- **Rename** operations for clarity (e.g., `get_api_v1_users` → `getUsers`)
- **Remove** noise: analytics (`/collect`, `/track`), CDN (`/static/`, `/_next/`), tracking pixels
- **Confirm** auth/CSRF/signing detection matches expectations
- **Review** against the relevant archetype's expectations (see `references/knowledge/archetypes/index.md`)
- **Update** DOC.md with auth, transport, extraction, and known issues discovered during curation

#### Extraction Complexity Rule

If an operation's extraction logic (the `expression` in openapi.yaml) exceeds ~5 lines, **extract it into an adapter file**:

```
src/sites/<site>/
├── openapi.yaml          ← references adapter, no inline JS
├── adapters/<site>.ts    ← complex DOM parsing logic lives here
```

In openapi.yaml, replace the inline expression with an adapter reference:
```yaml
x-openweb:
  adapter: ./adapters/<site>.ts
```

**Inline is OK for:** simple `ssr_next_data`, `page_global`, short `html_selector` (1–3 lines).
**Adapter is required for:** multi-line DOM queries, regex parsing, complex data transformation.

openapi.yaml should be readable as a spec, not a code dump.

### Step 4: Curate (Track B — WS/AsyncAPI)

If compile emitted `asyncapi.yaml`:

#### B1. Review WS Summary

- Channels detected (e.g., `/gateway`, `/ws/v2`)
- Message patterns (heartbeat, subscribe, event stream)
- Protocol classification (subscribe, publish, request_reply, stream)

#### B2. Curate AsyncAPI Spec

Review questions:
- Is the server URL canonical (not a CDN or monitoring endpoint)?
- Is the channel address/path correct?
- Are sent and received operations both represented where useful?
- Are control frames (ping/pong, close) excluded from tool surface?
- Does a stream op have deterministic `event_match`?
- Does a request_reply op have reliable correlation?
- Are subscribe/unsubscribe templates present and correct?
- Is the heartbeat interval detected correctly?

#### B3. Per-Archetype WS Expectations

See `references/knowledge/ws-patterns.md` for per-archetype WS checklists
(Messaging gateway, Crypto/Finance feeds, etc.)

#### Hybrid Packages (HTTP + WS)

When a site has both `openapi.yaml` and `asyncapi.yaml`:
- Review each independently — they may have different auth/transport
- Ensure WS operations don't duplicate HTTP operations (e.g., real-time feed vs REST feed)
- DOC.md should document both protocols and when each is appropriate

### Step 5: Verify

```bash
openweb verify <site>
```

A spec is **Ready** when curated + verified with PASS.

### Step 6: Update Knowledge

> Read `update-knowledge.md` — evaluate what you learned, write to `references/knowledge/` if novel.

## Execution Model Decision

A compile may emit `openapi.yaml`, `asyncapi.yaml`, or both. Review each independently. A site package is ready only when its useful protocols are curated, not merely emitted.

### Does the data come from WebSocket?

Yes → curate via Track B (Step 4) above.

### If HTTP/page data:

**Direct JSON replay works** (API returns JSON, no bot detection)?
→ Use `node` transport.

**Browser network stack required** (bot detection, TLS fingerprint, session binding)?
→ Use `page` transport.

**Page contains structured SSR/global/DOM data** and API is weak/noisy?
→ Use extraction (`ssr_next_data`, `page_global`, `html_selector`, `script_json`).

**Declarative extraction unreadable**, or site uses browser-internal logic?
→ Use adapter (`page.evaluate` with custom JS in `adapters/` directory).

### Anti-pattern: probing with curl/fetch before capture

**NEVER** test endpoints with curl, wget, fetch, or any direct HTTP tool during discovery. This poisons IP reputation with bot detection systems and can block even real browser sessions on the same IP. See `discover.md` "Browser First" rule.

The `--probe` flag in the compile step is the **only** safe way to test node transport — it runs after capture is complete and uses controlled, minimal requests.

## Common False Positives

- **Tracking cookies as auth**: Cloudflare, GA, Meta pixel cookies trigger cookie_session. Use `--probe` to catch.
- **Analytics as operations**: `/collect`, `/beacon`, `/pixel` — filter should catch most.
- **CDN endpoints**: `/static/`, `/_next/`, `/assets/` — should be filtered.
- **Dashboard noise**: SaaS dashboards (e.g. Stripe) generate heavy noise from internal namespaces. Manual curation must filter these.
- **Heartbeat-only WS**: WebSocket connections that only carry ping/pong — not useful as operations.
- **CDN/monitoring WS**: WebSocket endpoints for telemetry or CDN health checks — filter out.

## Common False Negatives

- **Auth not detected**: User wasn't logged in, or unsupported auth pattern.
- **CSRF not detected**: Token embedded in JavaScript (not cookie/meta tag) — identify manually.
- **Operations missing**: Key pages not visited during capture — recapture with targeted browsing.

## Related References

- `references/discover.md` — coverage responsibility (target intents, gap review)
- `references/site-doc.md` — DOC.md / PROGRESS.md template
- `references/update-knowledge.md` — when to write cross-site patterns
- `references/knowledge/archetypes/index.md` — per-archetype curation expectations
- `references/knowledge/auth-patterns.md` — auth primitive detection
- `references/knowledge/ws-patterns.md` — WS connection/message patterns
