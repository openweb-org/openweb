# Bot Detection Patterns

How major bot detection systems work, their impact on transport and capture strategy, and known workarounds.

## Detection Systems

### Cloudflare (Turnstile / Bot Management)

- **How it works:** JavaScript challenge on first visit sets `cf_clearance` cookie. Managed challenge or Turnstile widget on suspicious requests. Server-side rate limiting with `429` + `Retry-After`.
- **Detection signals:** TLS fingerprint (JA3), IP reputation, browser automation markers (`navigator.webdriver`), request rate
- **Symptoms:** `403` with Cloudflare challenge page, `429` rate limit, redirect to `/cdn-cgi/challenge-platform/`
- **Transport impact:** Node transport fails without valid `cf_clearance` -- use `page` transport or extract cookie from browser session
- **Capture strategy:** Start browser, solve challenge manually, then begin capture. Clearance cookie TTL: usually 30min-2h.

### Akamai (Bot Manager)

- **How it works:** Client-side sensor script (`_abck` cookie) fingerprints browser. Server checks sensor data on each request.
- **Detection signals:** JS execution environment, mouse/keyboard events, canvas fingerprint, WebGL, sensor data freshness
- **Symptoms:** `403` with empty or generic error body, `_abck` cookie with `~0~` (invalid sensor), request succeeds in browser but fails in Node
- **Transport impact:** Node transport almost never works. Must use `page` transport with real browser.
- **Capture strategy:** Record in a real browser session. The `_abck` cookie refreshes frequently -- keep capture sessions short.
- **Adapter pattern:** For Akamai-protected sites, content is often SSR HTML (not JSON APIs). Use adapter transport with `page.goto()` + DOM extraction via `page.evaluate()` string expressions. Avoid TypeScript function callbacks in `page.evaluate()` -- tsx transpilation injects `__name` helpers that fail in the browser context.
- **APIRequestContext also fails on write paths:** Even with `page` transport and a logged-in session, `page.request.fetch()` (Playwright APIRequestContext) can return `403` from `AkamaiGHost` while the same request from `page.evaluate(fetch(..., {credentials: 'include'}))` returns `200`. APIRequestContext shares cookies but its TLS / HTTP-2 fingerprint is detectable as non-browser; DOM fetch carries page origin + sec-fetch-* headers and runs inside the JS engine that solved the sensor challenge. **Action:** for Akamai-protected mutation endpoints, default to `pageFetch` / `page.evaluate(fetch())` instead of `page.request.fetch()`. Confirmed on costco.com cart endpoints (2026-04-19); cookies including `_abck`, `bm_sz`, `WC_AUTHENTICATION_*`, `JSESSIONID` were present in both cases, so the signal is the request fingerprint, not the session.

### PerimeterX (HUMAN Security)

- **How it works:** Client-side script sets `_px3` / `_pxhd` cookies. Server validates on each request. Block page uses a challenge (press-and-hold, CAPTCHA).
- **Detection signals:** JS environment, event patterns, cookie freshness
- **Symptoms:** `403` with JSON `{"appId":"PX...","vid":"...","uuid":"..."}`, block page HTML with `/captcha/` path
- **Transport impact:** Node transport fails. `page` transport works if the browser has solved the initial challenge.
- **API call blocking:** On aggressive PX sites (e.g. Zillow), both `page.evaluate(fetch())` AND `page.request.fetch()` are blocked — PX validates at network/cookie level, not just JS interception. Only full page navigation (`page.goto()`) works.
- **Stale session reset:** Navigate to `about:blank` → `context.clearCookies()` → wait 1s → retry navigation. This resets PX server-side state. First 1-2 attempts may still CAPTCHA; subsequent retries succeed. **Built into `warmSession`** — any spec using server- or op-level `page_plan: { warm: true }` inherits the clearCookies + retry loop (default 3 attempts, linear backoff). No adapter code required for this case.
- **Capture strategy:** Real browser, short sessions.
- **CDP tab closure:** Some PX-heavy sites close browser tabs after 1-2 sequential `page.goto()` calls via Playwright CDP. Workaround: for adapter-only sites, skip capture->compile and write the adapter directly.

### DataDome

- **How it works:** Server-side + client-side. Injects JS tag that posts device/browser data to `api-js.datadome.co`. Sets `datadome` cookie.
- **Detection signals:** IP reputation (aggressive), JS environment, device fingerprint, geographic anomalies
- **Symptoms:** `403` with `datadome` in response headers, redirect to `geo.captcha-delivery.com` CAPTCHA
- **Transport impact:** Very aggressive -- even `page` transport can fail if the browser profile looks automated. Best results with a real Chrome profile (managed browser auto-copies user's profile).
- **Capture strategy:** Browser auto-starts with real Chrome profile. For manual control, use `openweb browser start --profile <dir>`. Solve any CAPTCHA. Keep sessions short.

### Radware StormCaster

- **How it works:** Client-side sensor script sets `ry_ry-*` cookies (pattern: `ry_ry-<hash>`). Block page displays "Pardon Our Interruption" when sensor fails.
- **Detection signals:** `ry_ry-*` cookie prefix in captured traffic, "Pardon Our Interruption" in page title or body
- **Symptoms:** `403` with "Pardon Our Interruption" block page, short-lived `ry_ry-*` cookies that expire quickly
- **Transport impact:** Node transport fails -- cookies are short-lived and require JS sensor execution. Must use `page` transport.
- **Capture strategy:** Real browser, solve initial challenge. Short sessions due to aggressive cookie expiry.

### Multi-Layer Stacking

When a site deploys two or more detection systems simultaneously, each layer must be satisfied independently.

- **Detection signals:** Presence of 2+ vendor cookies from different systems (e.g., `_abck` + `datadome`, `_px3` + `cf_clearance`, `ry_ry-*` + `_abck`)
- **Impact:** Detection surfaces compound -- passing one layer's challenge does not satisfy the other. Even `page.evaluate(fetch)` may fail because each system fingerprints different aspects of the request.
- **Transport impact:** Assume page transport mandatory. Node transport and `page.evaluate(fetch)` are both unreliable.
- **Warm-up requirement:** The browser warm-up phase must trigger all sensors. Wait for all vendor cookies to be set before executing operations.
- **Action:** Document all detected layers in the site's DOC.md. Don't attempt node transport unless probe evidence contradicts.

### Custom Signing Spectrum

Detection of client-side request signing via monkey-patched browser APIs.

- **Detection signal:** `window.fetch.toString().length > 100` in browser console means `fetch` has been monkey-patched (native `fetch.toString()` is short). This indicates the site injects custom signing logic into every fetch call.
- **Impact:** `page.evaluate(fetch(...))` inherits the signing because it runs through the patched `fetch`. Node `fetch` does not have the patch and will fail.
- **Transport impact:** When signing is present, `page.evaluate(fetch)` works but node transport does not (missing signatures → 403 or invalid response). This is a positive signal for Tier 5 transport.
- **Verification:** Must verify via probe -- check `fetch.toString().length` in browser devtools before deciding transport. The monkey-patch may also exist on `XMLHttpRequest`.
- **Not all patches are signing:** Some patches are analytics/telemetry. Verify by comparing responses: if `page.evaluate(fetch)` succeeds but `node fetch` with identical headers fails, the patch adds required signing.

### "Try Before Assuming" Rule

DOC.md claims about bot detection may be outdated. Always probe before deciding transport.

- **Principle:** Treat DOC.md and historical claims as hypotheses, not facts. Bot detection configurations change without notice -- a site that needed page transport last month may have relaxed its detection, or vice versa.
- **Action:** Before accepting any transport decision based on documentation, run the [Node Feasibility Quick-Check](transport-upgrade.md#node-feasibility-quick-check) in transport-upgrade.md and cross-reference the [Disproved Assumptions](transport-upgrade.md#disproved-assumptions-pattern) table.
- **Common outdated claims:** "Site uses Akamai" (may have switched vendors), "API requires browser" (may have been opened), "Bot detection blocks everything" (may only block specific endpoints).
- **Evidence-based decisions:** Document actual probe results (HTTP status, response headers, cookie presence) in the site's DOC.md. Never propagate a transport claim without fresh evidence.

## Site-Specific Detection

Some sites roll their own detection in addition to (or instead of) commercial solutions:

| Pattern | Examples | Signal |
|---------|----------|--------|
| Custom request signing | e.g. some e-commerce, social media sites | `x-amzn-*`-style headers, custom HMAC, or per-request transaction ID headers computed client-side |
| Custom required headers | e.g. some social media, image-sharing sites | Requires `x-requested-with: XMLHttpRequest` or site-specific app ID headers -- 400/403 without |
| Encrypted payloads | e.g. some search engines, social platforms | Request body/params are base64/protobuf -- can't be replayed without the encoder |
| Rate-based blocking | Most APIs | `429` or silent empty responses after N requests/minute |
| Rate-based redirect loops | e.g. some professional networks | Rapid sequential node requests trigger redirect loops (>5 redirects) |
| Referrer/origin validation | Many sites | Requests without proper `Referer` or `Origin` header get `403` |
| Cookie chaining | e.g. banking, ticket sites | Multi-step cookie flow -- must visit specific pages in order |

## Transport Selection Decision Tree

```text
Can Node make the request without auth cookies?
  +- Yes -> node transport (fastest, simplest)
  +- No -> Does the site use bot detection?
       +- No/light (Cloudflare basic) -> node + browser cookie extraction
       +- Heavy (Akamai/PX/DataDome/custom) -> page transport
            +- Does page need specific JS context?
                 +- No -> page transport with evaluate
                 +- Yes -> adapter transport
                      +- Does page.evaluate(fetch(...)) work?
                           +- Yes -> adapter with pageFetch/graphqlFetch
                           +- No -> Does page.request.fetch() work?
                                +- Yes -> adapter with page.request.fetch (Costco pattern)
                                +- No (PX blocks all API calls) -> SSR extraction
                                     Navigate to target page, extract __NEXT_DATA__
                                     or intercept response from site's own JS
```

### Intercept Pattern (when `page.evaluate(fetch)` is blocked)

Some bot detection systems (notably Akamai Bot Manager) validate not just cookies
but also client-side sensor data attached to each request. `page.evaluate(fetch(...))`
bypasses the site's own JS, so the request lacks sensor headers and gets blocked
(e.g., HTTP 206 with `GenericError`).

**Fix:** Navigate to the real page URL and intercept the response that the site's
own React/JS code triggers:

```typescript
// Set up listener BEFORE navigation
let captured: unknown = null
page.on('response', async (resp) => {
  if (resp.url().includes('/graphql') && resp.url().includes('opname=searchModel')) {
    captured = await resp.json()
  }
})
// Navigate — site's own JS makes the API call with valid sensor headers
await page.goto('https://example.com/s/keyword', { waitUntil: 'load' })
// Poll until response captured
while (!captured) await wait(500)
```

This works because the site's own bundled JS carries valid sensor
data that programmatic fetch cannot replicate.

-> See: adapter-recipes.md § Response Interception for the general pattern

## Capture Strategy by Detection Level

| Detection Level | Capture Approach |
|----------------|-----------------|
| None | Headless browser or node proxy -- anything works |
| Light (Cloudflare basic) | Headed browser, solve challenge once, capture |
| Medium (Akamai, PerimeterX) | Real Chrome profile (auto-copied by managed browser), short sessions, don't replay requests |
| Heavy (DataDome, custom signing) | Real profile, manual browsing, record passively, extract patterns from traffic |

## General Principles

1. **Never fight the detection system** -- work within the browser where detection is already solved
2. **Prefer `page` transport** when in doubt -- it inherits all browser state
3. **Keep capture sessions short** -- most tokens/sensors expire in 5-30 minutes
4. **The managed browser copies your real Chrome profile** -- it has history/cookies that look legitimate
5. **Don't replay raw requests** -- extract the pattern (URL, params, headers) and let the transport regenerate auth headers
6. **Rate limit operations** -- even with valid auth, high request rates trigger server-side blocking
7. **Document detection in DOC.md** -- note the system and its impact in Known Issues

## Runtime Bot Detection

Two layers detect bot blocks at runtime, preventing adapters from silently returning garbage data:

### Generic layer: `detectPageBotBlock()` in `bot-detect.ts`

Runs **after every `adapter.execute()`** and **after every extraction operation** — checks the page for well-known vendor signals:

| Check | Pattern | Vendor |
|-------|---------|--------|
| URL | `captcha-delivery.com` | DataDome |
| URL | `challenges.cloudflare.com` | Cloudflare |
| Title | `access denied` | PerimeterX |
| Title | `attention required` | Cloudflare |
| Title | `just a moment` | Cloudflare |
| Selector | `#px-captcha` | PerimeterX |
| Selector | `iframe[src*="captcha-delivery.com"]` | DataDome |

If any signal matches, `adapter.execute()` result is discarded and `bot_blocked` error is thrown.

### Site-specific layer: inside individual adapters

Adapters can detect site-specific bot patterns using the `errors.botBlocked(msg)` helper:

```ts
// Example: rate-limit redirect detection
if (page.url().includes('ratelimited.')) throw errors.botBlocked('Rate limited')
```

Use this for patterns that are **unique to a site** and not covered by the generic layer (e.g., custom rate-limit subdomains, site-specific block pages).

### Adding new patterns

- **Generic layer:** Only add patterns that are (a) from a well-known vendor, or (b) confirmed on a real page during testing. Never guess selectors or title strings.
- **Site layer:** Preferred for site-specific patterns. Check page URL or title inside the adapter's operation handler or `navigateTo()`.

-> See: `src/runtime/bot-detect.ts` (generic layer implementation)
