# Troubleshooting Patterns

Known failure patterns and fixes, extracted from M3–M18 experience and M26 discovery.

## Auth Failures

### 401/403 after token cache hit
**Cause**: Cached tokens expired.
**Fix**: Clear token cache and retry with fresh browser extraction. Run `openweb browser restart` to clear cache, then retry.

### cookie_session detected on public API
**Cause**: Public APIs may set tracking cookies that look like sessions.
**Fix**: Verify with `--probe` flag during compile. If API works without cookies, remove auth from spec.

### MSAL token not found in sessionStorage
**Cause**: User not logged in to Microsoft service, or MSAL cache expired.
**Fix**: `openweb login <site>` → log in → `openweb browser restart` → retry.

### exchange_chain token endpoint returns 403
**Cause**: Missing required cookies, wrong User-Agent, or Cloudflare protection.
**Fix**: Ensure browser has active session. Some exchange chains require specific User-Agent binding (e.g., ChatGPT).

## Discovery / Capture Failures

### Service worker page matched instead of user page
**Cause**: `findPageForOrigin` matched a service worker page.
**Fix**: Filter out service worker pages — they are not user-visible.

### Backgrounded tab returns undefined for page.evaluate
**Cause**: Chrome discards JS heap in backgrounded tabs.
**Fix**: Detect tab discard and reload before extraction.

### SPA page with long bootstrap time (10s+)
**Cause**: Webpack chunk loading, framework bootstrap.
**Fix**: Wait for network idle, not just DOMContentLoaded. SPA bootstrap timing varies.

### pnpm dev stdout contains non-JSON banner text
**Cause**: pnpm outputs banner text that corrupts JSON parsing.
**Fix**: Always use `pnpm --silent dev` to suppress banner.

### Login wall detected during capture
**Cause**: Site requires authentication, user not logged in.
**Fix**: `openweb login <site>` → log in in default browser → `openweb browser restart` → retry.

## Compile Failures

### No filtered samples after analyzer filtering
**Cause**: All captured traffic was filtered as noise (tracking, CDN, infrastructure). Also happens when a site uses protobuf-encoded parameters (like Google Maps' `pb` parameter) or map tiles that the analyzer doesn't recognize as API traffic.
**Fix**: Browse more pages to capture real API traffic. Check that target URL matches the site's API domain. For sites with unusual API formats (protobuf, binary, non-standard encoding), manual fixture creation may be required — the compiler cannot handle all patterns.

### No operations produced from clusters
**Cause**: All endpoints were mutations with request bodies (skipped by safety gate) or all samples filtered.
**Fix**: Ensure GET requests are captured. Browse read-only pages (profile, feed, search results).

### POST/PUT endpoint without recorded request body
**Cause**: Mutation operations can't be auto-generated without body inference.
**Fix**: These are skipped during compile. Agent should identify and model these manually if needed.

### GraphQL endpoint flagged for mutation risk
**Cause**: GraphQL queries via POST may contain mutations.
**Fix**: Review GraphQL operations carefully. Assign appropriate permissions.

## Verify / Drift Failures

### Response status 429 or Retry-After header
**Cause**: Rate limiting by the target site.
**Fix**: Mark as retriable, not DRIFT or FAIL. Wait and retry.

### Probe request sent to wrong host
**Cause**: Probe URL built from CLI URL instead of operation host.
**Fix**: Ensure probe URL uses `operation.host`, not CLI-provided URL.

### Redirect during probe escapes to internal network
**Cause**: Redirect chain can target internal/private IP ranges.
**Fix**: SSRF validation on each redirect hop (already enforced by fetchWithValidatedRedirects).

### Response schema mismatch (field X vs field Y)
**Cause**: API schema drift — field names change between versions.
**Fix**: Regenerate schema from fresh response. Compare with existing spec and update.

### Persistent DRIFT on dynamic endpoints (search results)
**Cause**: Search and recommendation endpoints return different products on each call. Different products have different field structures (some have `similarItems`, others don't), so the response shape fingerprint changes every time.
**Fix**: This is expected behavior, not a bug. Clear the stored fingerprint before the definitive verify run. The first verify after clearing will PASS (no stored hash to compare against). Subsequent verifies will show DRIFT — this is informational. Schema validation (status + schema_valid) is the authoritative check; fingerprint DRIFT on dynamic endpoints should not block acceptance.

## Browser / CDP Failures

### Bot detection blocks CDP browser (even non-headless)
**Cause**: E-commerce sites (Walmart, Amazon) use bot detection (PerimeterX, DataDome) that fingerprints CDP-connected browsers. Both headless and non-headless modes are detected — the CDP protocol itself is the signal.
**Fix**: For Next.js sites, use node-based SSR extraction instead of browser extraction. Direct HTTP `fetch()` from Node.js is not blocked — it returns full SSR HTML with `__NEXT_DATA__` embedded. Set `transport: node` + `extraction.type: ssr_next_data` in the fixture. The runtime will fetch the page via HTTP and parse `__NEXT_DATA__` without a browser. For non-Next.js sites blocked by bot detection, there is currently no workaround.

### IP poisoning from direct HTTP probes during discovery
**Cause**: Using curl/fetch/wget to probe a site's endpoints before browser capture. Bot detection systems (PerimeterX, DataDome) track IP reputation. Non-browser HTTP requests have fundamentally different TLS fingerprints (JA3/JA4) and HTTP/2 settings — even with a correct User-Agent, the TLS handshake exposes the client as non-browser. Each probe raises the IP's risk score. After enough probes, the IP is flagged and ALL requests from it — including real browser sessions — trigger unsolvable CAPTCHAs.
**Symptoms**: PerimeterX "Press & Hold" CAPTCHA that never resolves, even in a real browser with a real user interaction. Affects managed browser AND user's default browser on the same network.
**Fix**: No immediate fix once IP is poisoned. Wait 15–60 minutes for PX risk score to decay, or switch to a different IP (VPN, mobile hotspot). **Prevention**: Never use curl/fetch to probe during discovery. Always use the browser first. See `discover.md` "Browser First" rule.
**Observed on**: Zillow (PerimeterX app ID `PXHYx10rg3`). Five-layer detection: TLS fingerprint → HTTP/2 fingerprint → JS challenge → behavioral analysis → IP reputation.

### Could not connect to CDP
**Cause**: Managed browser not running.
**Fix**: `openweb browser start` → retry.

### No tab matches site URL
**Cause**: Browser connected but site not open.
**Fix**: User should open a tab to the site URL, or use `openweb login <site>`.

## CSS / DOM Failures

### Selector with special characters fails
**Cause**: Unescaped colons, brackets in CSS selectors.
**Fix**: Use `CSS.escape()` for DOM-derived id/name values.
