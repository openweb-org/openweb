# Troubleshooting

## Process

### Step 1: Classify

| Symptom | Category |
|---------|----------|
| 401, 403, token errors | [Auth](#auth) |
| No traffic captured, login redirect | [Discovery](#discovery) |
| No operations in spec | [Compile](#compile) |
| Verify fails, schema mismatch, 429 | [Verify](#verify) |
| CDP connection error, no tab | [Browser](#browser) |
| WS handshake rejected, disconnect | [WebSocket](#websocket) |
| GraphQL 404, hash mismatch | [GraphQL](#graphql) |
| Stale token, cross-site conflict | [Token Vault](#token-vault) |

### Step 2: Check patterns

Jump to the matching category. Most failures match a known pattern.

### Step 3: Diagnose (if no match)

1. Check exact error message and HTTP status
2. `openweb browser status` — is Chrome running?
3. Set `"debug": true` in `~/.openweb/config.json`, re-run
4. Check site's `openapi.yaml` — endpoint/auth correct?
5. Compare with a working site of the same archetype (`knowledge/archetypes/index.md`)

### Step 4: Fix and verify

```bash
openweb verify <site>          # single site
pnpm build && pnpm test        # no regressions
```

If fix revealed something novel → read `add-site/document.md` for knowledge update guidance.

---

## Auth

### Expired or Missing Cookie

**Symptom:** `401`/`403`; body says "session expired" or redirects to login.
**Fix:** `openweb login <site>` then `openweb verify <site>`. If token-cached: `openweb browser restart`.

### CSRF Token Mismatch

**Symptom:** `403` "invalid CSRF token" on POST/PUT/DELETE.
**Fix:** ensure openapi.yaml includes the CSRF header (`add-site/curate-runtime.md`). Sites rotating CSRF per page load require `page` transport.

### Cookie Domain Mismatch

**Symptom:** auth works in browser but ops fail — cookies not sent (API on `api.example.com`, cookies on `www.example.com`).
**Fix:** set `domain` in the site's auth config to cover the API subdomain.

---

## Discovery

### No Traffic Captured

**Symptom:** capture produces empty output, 0 requests.
**Fix:** verify Chrome is running (`openweb browser status`), verify CDP endpoint, ensure you browsed the site during capture. See `add-site/capture.md`.

### Login Redirect Loop

**Symptom:** all captured URLs are `/login` or OAuth flows.
**Fix:** complete login first, `openweb verify <site>`, then start capture.

---

## Compile

### No Operations Extracted

**Symptom:** openapi.yaml has empty `paths`.
**Fix:** check capture data — were API calls recorded? SSR-only sites need extraction patterns (`knowledge/extraction.md`).

### Duplicate Operations

**Symptom:** `searchProducts_1`, `searchProducts_2` with identical shapes.
**Fix:** merge during curation. Varying params (pagination, timestamps) should be parameterized (`add-site/curate-operations.md`).

---

## Verify

### DRIFT

**Symptom:** `openweb verify` returns `DRIFT`.
**Fix:** if intentional API change, re-run `openweb compile`. If transient (A/B test), note in DOC.md.

### Rate Limiting (429)

**Symptom:** `FAIL` with `429`, especially on `--all`.
**Fix:** add delays between operations. Verify a subset.

---

## Browser

### CDP Connection Refused

**Symptom:** `ECONNREFUSED 127.0.0.1:9222`.
**Fix:** browser auto-starts when needed. If auto-start fails, check Chrome is installed. Manual: `openweb browser start`. Port conflict: check if 9222 is in use.

### Stale Browser Session

**Symptom:** ops fail silently or return empty data; browser shows running.
**Fix:** `openweb browser restart` — kills session, re-copies profile, clears token cache.

### URL Encoding Issues (HTTP 400)

**Symptom:** `400` from `page.evaluate(fetch(...))` — unencoded JSON chars in query string.
**Fix:** ensure values use `encodeURIComponent`. Compare sent URL (debug browser-fetch-executor) with browser's native URL.

---

## Bot Detection / CAPTCHA

### CAPTCHA or Challenge Page

**Symptom:** `bot_blocked` error — DataDome redirect to `geo.captcha-delivery.com`, PerimeterX "Access Denied" / "Press & Hold", Cloudflare challenge.

**Key insight:** The managed browser is **headless by default** — the user cannot see or interact with it. You must make it visible first.

**Fix:**
1. `openweb browser restart --no-headless` — makes the managed browser visible
2. User solves the CAPTCHA in the visible browser window
3. Retry the operation
4. Optionally `openweb browser restart` to return to headless

For sites that consistently trigger CAPTCHAs, set `"browser": {"headless": false}` in `~/.openweb/config.json` for persistent headed mode.

**Note:** This is different from `needs_login` — login happens in the user's default browser (cookies get copied to managed browser). CAPTCHAs must be solved in the managed browser itself because the challenge cookie/state must stay in that session.

### Adapter Returns Garbage Data (fake PASS)

**Symptom:** Operation returns `200` with structurally valid but meaningless data — e.g., `name: "Access Denied"`, `drugName: "Access"`, `description: ""`. Verify reports PASS or DRIFT instead of `bot_blocked`.

**Root cause:** Adapter scraped a CAPTCHA/block page and extracted DOM elements as if they were real data. The generic `detectPageBotBlock()` check in `adapter-executor.ts` catches known vendor patterns (PerimeterX, DataDome, Cloudflare), but site-specific block pages may slip through.

**Fix:** Add site-specific bot detection in the adapter — check `page.url()` or page content after navigation. Use `errors.botBlocked(msg)` to throw the correct error. Example: Redfin's adapter checks for redirect to `ratelimited.redfin.com`.

-> See: `knowledge/bot-detection.md` § Runtime Bot Detection

### Site-Specific Rate Limiting

**Symptom:** `bot_blocked` with site-specific message (e.g., "Rate limited by Redfin"). Not a CAPTCHA — site redirected to a custom block page.

**Fix:** Same as CAPTCHA — wait, then retry. Rate limits typically clear after a few minutes without the headed browser workaround.

---

## WebSocket

### Connection Upgrade Rejected

**Symptom:** `400`/`403` on WS handshake.
**Fix:** check if WS endpoint requires auth cookies. Some sites validate `Origin`. Use `page` transport so browser handles handshake.

### Heartbeat Timeout / Disconnect

**Symptom:** WS drops after 30-60s; close code `1000`/`1006`.
**Fix:** site expects heartbeat pings. Check captured traffic for pattern (`knowledge/ws.md`). Implement in adapter.

### Message Deserialization Failure

**Symptom:** WS messages received but unparseable (binary, compressed, protobuf, MessagePack).
**Fix:** check `Sec-WebSocket-Extensions` for `permessage-deflate`. If protobuf, find `.proto` schema in site JS. Document encoding in DOC.md.

### Subscription Not Acknowledged

**Symptom:** subscribe sent, no data; server may respond `{"error":"invalid channel"}`.
**Fix:** verify subscribe format against captured traffic. Some sites require `identify`/`auth` message first.

### Reconnection Loop

**Symptom:** rapid connect/disconnect, never stabilizes.
**Fix:** check for required protocol version or subprotocol. Verify resume payload (session_id, seq). Add backoff.

---

## GraphQL

### Rotating Query Hashes (HTTP 404)

**Symptom:** `404` on GraphQL endpoints; persisted query hash doesn't match server's current hash.
**Root cause:** site rotates hashes on each frontend deploy.
**Fix:** do NOT hardcode hashes. Use L3 adapter to extract at runtime from JS bundle — parse `queryId:"xxx",operationName:"yyy"` via `page.evaluate`. See `knowledge/graphql.md`.

### Missing Request Signing (HTTP 404)

**Symptom:** `404` despite correct hashes/auth; browser requests include signing header (e.g. `x-client-transaction-id`), `page.evaluate(fetch(...))` without it returns 404.
**Fix:** grep minified JS for the header name, trace to signing module, call via webpack `require(moduleId)` in `page.evaluate`. See `knowledge/auth-primitives.md`.

---

## Token Vault

### Cache Returns Stale Token

**Symptom:** `401` but browser is authenticated; JWT `exp` in the past.
**Fix:** `openweb browser restart` to clear cache. Check if TTL is too long for short-lived JWTs.

### Token Extraction Fails After Site Update

**Symptom:** auth ops return `401`, browser session valid; site changed token delivery (cookie name, header format, or moved to bearer).
**Fix:** re-capture auth flow, update auth config, `openweb browser restart`, `openweb verify <site>`.

### Cross-Site Token Conflict

**Symptom:** logging into site B invalidates site A (shared parent domain or SSO, cookie scope overlaps).
**Fix:** document in both DOC.md files. Use separate browser profiles if possible, or verify sequentially.

---

## After Fixing

Read `add-site/document.md` for when to update DOC.md vs cross-site knowledge files.

## Related

- `add-site/guide.md` — add-site workflow (re-capture/re-compile)
- `add-site/curate-runtime.md` — auth/transport/extraction config
- `references/cli.md` — CLI commands and browser management
- `knowledge/auth-primitives.md` — auth primitive details
- `knowledge/ws.md` — WS patterns
- `knowledge/graphql.md` — persisted queries, hash rotation
