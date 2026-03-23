# Troubleshooting

Common failures and solutions, extracted from M3–M18 experience and seed patterns.

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
**Cause**: All captured traffic was filtered as noise (tracking, CDN, infrastructure).
**Fix**: Browse more pages to capture real API traffic. Check that target URL matches the site's API domain.

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

## Browser / CDP Failures

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

## After Troubleshooting

→ Read `update-knowledge.md` — if you learned something novel during debugging, write it to `knowledge/`.
