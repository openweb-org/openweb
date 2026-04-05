# Troubleshooting

Process and known failure patterns for diagnosing openweb failures.

## Process

### Step 1: Classify

| Symptom | Category |
|---------|----------|
| 401, 403, token errors | [Auth](#auth-failures) |
| No traffic captured, login redirect | [Discovery](#discovery-failures) |
| No operations in compiled spec | [Compile](#compile-failures) |
| Verify fails, schema mismatch, 429 | [Verify](#verify-failures) |
| CDP connection error, no tab | [Browser](#browser-failures) |
| WS handshake rejected, disconnect | [WebSocket](#websocket-failures) |
| GraphQL 404, hash mismatch | [GraphQL](#graphql-failures) |
| Stale token, cross-site conflict | [Token Vault](#token-vault-failures) |

### Step 2: Check patterns

Jump to the matching category below. Most failures match a known pattern.

### Step 3: Diagnose (if no pattern match)

1. Check exact error message and HTTP status
2. `openweb browser status` — is Chrome running?
3. Set `"debug": true` in `~/.openweb/config.json`, re-run
4. Check the site's `openapi.yaml` — endpoint/auth correct?
5. Compare with a working site of the same archetype (`knowledge/archetypes/index.md`)

### Step 4: Fix and verify

```bash
openweb verify <site>          # single site
pnpm build && pnpm test        # no regressions
```

If the fix revealed something novel → read `add-site/document.md` for knowledge update guidance.

---

## Auth Failures

### Expired or Missing Cookie

**Symptom:** `401`/`403` on previously working operations; body says "session expired" or redirects to login.
**Fix:** `openweb login <site>` then `openweb verify <site>`. If token-cached: `openweb browser restart`.

### CSRF Token Mismatch

**Symptom:** `403` "invalid CSRF token" on POST/PUT/DELETE; site sends CSRF in cookie/meta tag but request lacks the header.
**Fix:** ensure openapi.yaml includes the CSRF header. Add during curation (`add-site/curate-runtime.md`). Sites that rotate CSRF per page load require `page` transport.

### Cookie Domain Mismatch

**Symptom:** auth works in browser but ops fail — cookies not sent. API on `api.example.com`, cookies on `www.example.com`.
**Fix:** set `domain` explicitly in the site's auth config to cover the API subdomain.

---

## Discovery Failures

### No Traffic Captured

**Symptom:** capture produces empty output, `openweb capture stop` reports 0 requests.
**Fix:** verify Chrome is running (`openweb browser status`), verify CDP endpoint, ensure you browsed the site during capture. See `add-site/capture.md`.

### Login Redirect Loop

**Symptom:** all captured URLs are `/login` or OAuth flows.
**Fix:** complete login manually first, `openweb verify <site>`, then start capture.

---

## Compile Failures

### No Operations Extracted

**Symptom:** compile finishes, openapi.yaml has empty `paths`.
**Fix:** check capture data — were API calls recorded? SSR-only sites (no XHR/fetch) need extraction patterns (`knowledge/extraction.md`).

### Duplicate Operations

**Symptom:** `searchProducts_1`, `searchProducts_2` with identical shapes.
**Fix:** merge during curation. Varying params (pagination, timestamps) should be parameterized. See `add-site/curate-operations.md`.

---

## Verify Failures

### DRIFT

**Symptom:** `openweb verify` returns `DRIFT` — response shape changed.
**Fix:** if intentional API change, re-run `openweb compile`. If transient (A/B test), note in DOC.md.

### Rate Limiting (429)

**Symptom:** `FAIL` with `429` on verify, especially `--all`.
**Fix:** add delays between operations. Reduce verify frequency or verify a subset.

---

## Browser Failures

### CDP Connection Refused

**Symptom:** `ECONNREFUSED 127.0.0.1:9222`.
**Fix:** browser auto-starts when needed. If auto-start fails, check Chrome is installed and in PATH. Manual: `openweb browser start`. Port conflict: check if 9222 is in use.

### Stale Browser Session

**Symptom:** ops fail silently or return empty data; `openweb browser status` shows running.
**Fix:** `openweb browser restart` — kills session, re-copies profile, clears token cache.

### URL Encoding Issues (HTTP 400)

**Symptom:** `400` from `page.evaluate(fetch(...))` — URL has unencoded JSON chars (`{`, `}`, `"`) in query string.
**Fix:** ensure values use `encodeURIComponent`. Compare sent URL (debug browser-fetch-executor) with browser's native URL (CDP `Network.requestWillBeSent`).

---

## WebSocket Failures

### Connection Upgrade Rejected

**Symptom:** `400`/`403` on WS handshake.
**Fix:** check if WS endpoint requires auth cookies on upgrade. Some sites validate `Origin` header. Use `page` transport so browser handles handshake.

### Heartbeat Timeout / Disconnect

**Symptom:** WS drops after 30-60s inactivity; close code `1000`/`1006`.
**Fix:** site expects heartbeat pings. Check captured traffic for heartbeat pattern (`knowledge/ws.md`). Implement in adapter.

### Message Deserialization Failure

**Symptom:** WS messages received but unparseable — binary, compressed, or non-JSON (protobuf, MessagePack).
**Fix:** check `Sec-WebSocket-Extensions` for `permessage-deflate`. If protobuf, find `.proto` schema in site JS bundles. Document encoding in DOC.md.

### Subscription Not Acknowledged

**Symptom:** subscribe sent, no data received; server may respond `{"error":"invalid channel"}`.
**Fix:** verify subscribe format against captured traffic. Some sites require `identify`/`auth` message before subscriptions.

### Reconnection Loop

**Symptom:** rapid connect/disconnect, never stabilizes.
**Fix:** check for required protocol version or subprotocol in upgrade. Verify resume payload (session_id, seq). Add backoff between reconnects.

---

## GraphQL Failures

### Rotating Query Hashes (HTTP 404)

**Symptom:** `404` on GraphQL endpoints that previously worked; persisted query hash doesn't match server's current hash (returns 404, not 400).
**Root cause:** site rotates hashes on each frontend deploy.
**Fix:** do NOT hardcode hashes. Use L3 adapter to extract at runtime from JS bundle — parse `queryId:"xxx",operationName:"yyy"` via `page.evaluate`. See `knowledge/graphql.md`.

### Missing Request Signing (HTTP 404)

**Symptom:** `404` on some endpoints despite correct hashes/auth; browser requests succeed (include signing header like `x-client-transaction-id`), `page.evaluate(fetch(...))` without it returns 404.
**Root cause:** per-request computed signature required.
**Fix:** grep minified JS for the header name (e.g., `"x-client-transaction-id"]=await`), trace to signing module, call via webpack `require(moduleId)` in `page.evaluate`. See `knowledge/auth-primitives.md`.

---

## Token Vault Failures

### Cache Returns Stale Token

**Symptom:** `401` but browser is authenticated; JWT `exp` claim in the past, cache hasn't evicted.
**Fix:** `openweb browser restart` to clear cache. Check if TTL is too long for short-lived JWTs.

### Token Extraction Fails After Site Update

**Symptom:** auth ops return `401`, browser session valid; site changed token delivery (different cookie name, header format, or moved to bearer).
**Fix:** re-capture auth flow, update site's auth config, `openweb browser restart`, `openweb verify <site>`.

### Cross-Site Token Conflict

**Symptom:** logging into site B invalidates site A; shared parent domain or SSO, cookie scope overlaps.
**Fix:** document in both DOC.md files. Use separate browser profiles if possible, or verify sites sequentially.

---

## After Fixing

> Read `add-site/document.md` — covers when to update site-specific DOC.md vs cross-site knowledge files.

## Related

- `add-site/guide.md` — add-site workflow (re-capture/re-compile)
- `add-site/curate-runtime.md` — auth/transport/extraction config
- `references/cli.md` — CLI commands and browser management
- `knowledge/auth-primitives.md` — auth primitive details
- `knowledge/ws.md` — WS patterns
- `knowledge/graphql.md` — persisted queries, hash rotation
