# Troubleshooting Patterns

Known failure patterns organized by category. Referenced from [troubleshooting.md](../troubleshooting.md).

## Auth Failures

### Expired or Missing Cookie

- **Symptoms:** `401` or `403` on operations that previously worked
- **Detection signals:** response body mentions "session expired", "login required", or returns a redirect to login page
- **Action:** run `openweb login <site>`, then `openweb verify <site>`. If using token cache, run `openweb browser restart` to clear stale tokens.

### CSRF Token Mismatch

- **Symptoms:** `403` with "invalid CSRF token" or "forbidden" on POST/PUT/DELETE
- **Detection signals:** site sends a CSRF token in a cookie or meta tag; the request is missing the corresponding header
- **Action:** check if the site package's openapi.yaml includes the CSRF header. If not, add it during compile. Some sites rotate CSRF tokens per page load — requires `page` transport.

### Cookie Domain Mismatch

- **Symptoms:** auth works in browser but operations fail — cookies not being sent
- **Detection signals:** site uses a subdomain for API (`api.example.com`) but cookies are set on `www.example.com`
- **Action:** check cookie domain scope. The browser profile copy may not include subdomain cookies. Set `domain` explicitly in the site package's auth config.

## Discovery Failures

### No Traffic Captured

- **Symptoms:** capture produces empty or near-empty output
- **Detection signals:** `openweb capture stop` reports 0 requests
- **Action:** verify Chrome is running (`openweb browser status`), verify the CDP endpoint is correct, check that you browsed the site during capture.

### Login Redirect Loop

- **Symptoms:** every page redirects to login, capture only records redirect responses
- **Detection signals:** all captured URLs are `/login`, `/auth`, or OAuth flows
- **Action:** complete login manually first, verify with `openweb verify <site>`, then start capture.

## Compile Failures

### No Operations Extracted

- **Symptoms:** compile finishes but the site package has 0 operations
- **Detection signals:** empty `paths` in generated openapi.yaml
- **Action:** check the capture data — were API calls recorded? If the site uses only SSR (no XHR/fetch), the compiler won't find API operations. Use extraction patterns (see [extraction-patterns.md](extraction-patterns.md)).

### Duplicate Operations

- **Symptoms:** multiple operations for the same logical action with slight URL variations
- **Detection signals:** operations like `searchProducts_1`, `searchProducts_2` with identical shapes
- **Action:** merge during compile review. URL params that vary per request (pagination, timestamps) should be parameterized, not create new operations.

## Verify Failures

### DRIFT

- **Symptoms:** `openweb verify` returns `DRIFT` for an operation
- **Detection signals:** response shape changed — missing fields, new fields, type changes
- **Action:** check if the site updated its API. Re-run `openweb compile` to update the site package if the change is intentional. If it's a transient issue (e.g., A/B test), note it in DOC.md.

### Rate Limiting (429)

- **Symptoms:** `FAIL` on verify with `429` status, especially when running `--all`
- **Detection signals:** `429 Too Many Requests`, `Retry-After` header
- **Action:** add delays between operations. Check if the site documents rate limits. Consider reducing verify frequency.

## Browser Failures

### CDP Connection Refused

- **Symptoms:** `Error: connect ECONNREFUSED 127.0.0.1:9222`
- **Detection signals:** no Chrome process running, or Chrome launched without `--remote-debugging-port`
- **Action:** run `openweb browser start`. If already running, check `openweb browser status`. Port conflict: check if another process uses 9222.

### Stale Browser Session

- **Symptoms:** operations fail silently or return empty data, but browser appears running
- **Detection signals:** `openweb browser status` shows running but operations return unexpected results
- **Action:** `openweb browser restart` — kills the old session, re-copies the profile, clears token cache.

## WebSocket Failures

### Connection Upgrade Rejected

- **Symptoms:** `HTTP 400` or `403` on the WebSocket handshake
- **Detection signals:** error during `new WebSocket()` or CDP reports `WebSocket connection failed`, response headers indicate the upgrade was denied
- **Action:** check if the WS endpoint requires auth headers or cookies on the upgrade request. Some sites validate `Origin` header — ensure it matches the site domain. Use `page` transport so the browser handles the handshake.

### Heartbeat Timeout / Disconnect

### Rotating GraphQL Hashes (HTTP 404)

- **Symptoms:** `HTTP 404` on GraphQL endpoints that previously worked, verify shows all ops failing
- **Detection signals:** persisted query hash in URL path doesn't match server's current hash (server returns 404, not 400)
- **Root cause:** site rotates query hashes on each frontend deploy (e.g., X/Twitter deploys several times per week)
- **Action:** do NOT hardcode hashes in example files. Use an L3 adapter that extracts hashes at runtime from the JS bundle. Pattern: parse `queryId:"xxx",operationName:"yyy"` from the main.js bundle in `page.evaluate`
- **Example:** X/Twitter `x-graphql` adapter

### Missing Request Signing (HTTP 404)

- **Symptoms:** `HTTP 404` on some endpoints but not others, even with correct hashes and auth
- **Detection signals:** browser's own requests succeed (they include `x-client-transaction-id` or similar signing header), but `page.evaluate(fetch(...))` without the header returns 404
- **Root cause:** site requires a per-request computed signature on certain endpoints
- **Action:** find the signing function in the webpack bundle. Grep the minified JS for the header name being set (e.g., `"x-client-transaction-id"]=await`), trace back to the signing module, then call it via webpack `require(moduleId)` in `page.evaluate`
- **Example:** X/Twitter — `x-client-transaction-id` from webpack module 938838 export `jJ`, function signature `(host, path, method) → string`

### URL Encoding Issues (HTTP 400)

- **Symptoms:** `HTTP 400` with empty response body from `page.evaluate(fetch(...))`
- **Detection signals:** URL contains unencoded JSON characters (`{`, `}`, `"`) in query string — server rejects malformed URL
- **Root cause:** `encodeQueryValue` or URL builder doesn't encode all special characters
- **Action:** ensure query parameter values are fully URL-encoded via `encodeURIComponent`. Compare the URL being sent (add debug logging to browser-fetch-executor) with the URL the browser sends natively (capture via CDP Network.requestWillBeSent)


- **Symptoms:** WS connection drops after 30–60 seconds of inactivity
- **Detection signals:** `close` event with code `1000` or `1006`, server sends no data after initial connection
- **Action:** the site expects heartbeat/ping frames at a specific interval. Check captured traffic for the heartbeat pattern (see [ws-patterns.md](ws-patterns.md)). Implement the heartbeat in the adapter.

### Message Deserialization Failure

- **Symptoms:** WS messages received but cannot be parsed — adapter returns empty or error
- **Detection signals:** messages are binary (opcode 2), compressed (zlib/zstd), or use a non-JSON format (protobuf, MessagePack)
- **Action:** check the `Sec-WebSocket-Extensions` response header for `permessage-deflate`. If compressed, decompress before parsing. If protobuf, identify the `.proto` schema from the site's JS bundles. Document the encoding in DOC.md.

### Subscription Not Acknowledged

- **Symptoms:** subscribe message sent but no data received, connection stays open
- **Detection signals:** no server response after sending subscribe frame, or server responds with an error like `{"error":"invalid channel"}`
- **Action:** verify the subscribe message format against captured traffic. Channel names, product IDs, and auth tokens may be required. Some sites require the `identify`/`auth` message before any subscription.

### Reconnection Loop

- **Symptoms:** adapter repeatedly connects and disconnects, never stabilizes
- **Detection signals:** rapid succession of connect/disconnect events in logs, server sends `close` immediately after connect
- **Action:** check if the server requires a specific protocol version or subprotocol in the upgrade request. Verify that the resume/reconnect payload (session_id, seq) is correct. Rate limiting on connections is common — add backoff between reconnect attempts.

## Token Vault Failures

### Cache Returns Stale Token

- **Symptoms:** operation fails with `401` but `openweb browser status` shows the browser is authenticated
- **Detection signals:** token in `$OPENWEB_HOME/tokens/<site>/` has expired but the cache hasn't evicted it, JWT `exp` claim is in the past
- **Action:** run `openweb browser restart` to clear the token cache. Check if the TTL config for this site is too long — JWT tokens with short expiry (e.g., 5 min) need a matching cache TTL.

### Token Extraction Fails After Site Update

- **Symptoms:** auth operations that previously worked now return `401`, browser session is valid
- **Detection signals:** the site changed how it issues tokens — different cookie name, different header format, moved from cookie to `Authorization` bearer
- **Action:** re-capture the auth flow. Update the site package's auth config to match the new token delivery mechanism. Clear the token cache (`browser restart`), then `openweb verify <site>`.

### Cross-Site Token Conflict

- **Symptoms:** logging into site B invalidates auth for site A
- **Detection signals:** both sites share a parent domain or use the same SSO provider, cookie scope overlaps
- **Action:** document the conflict in both sites' DOC.md. Use separate browser profiles if possible. As a workaround, verify sites sequentially rather than concurrently.

## Related References

- `references/troubleshooting.md` — process guide for diagnosing failures
- `references/discover.md` — discovery workflow context
- `references/compile.md` — compile review context
- `references/knowledge/auth-patterns.md` — auth primitive detection details
- `references/knowledge/ws-patterns.md` — WS connection/message patterns
