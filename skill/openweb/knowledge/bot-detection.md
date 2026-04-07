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
- **Adapter pattern:** For Akamai-protected sites like Amazon, most content is SSR HTML (not JSON APIs). Use adapter transport with `page.goto()` + DOM extraction via `page.evaluate()` string expressions. Avoid TypeScript function callbacks in `page.evaluate()` -- tsx transpilation injects `__name` helpers that fail in the browser context.

### PerimeterX (HUMAN Security)

- **How it works:** Client-side script sets `_px3` / `_pxhd` cookies. Server validates on each request. Block page uses a challenge (press-and-hold, CAPTCHA).
- **Detection signals:** JS environment, event patterns, cookie freshness
- **Symptoms:** `403` with JSON `{"appId":"PX...","vid":"...","uuid":"..."}`, block page HTML with `/captcha/` path
- **Transport impact:** Node transport fails. `page` transport works if the browser has solved the initial challenge.
- **Capture strategy:** Real browser, short sessions.
- **CDP tab closure:** Some PX-heavy sites (e.g., GoodRx) close browser tabs after 1-2 sequential `page.goto()` calls via Playwright CDP. Workaround: for adapter-only sites, skip capture->compile and write the adapter directly.

### DataDome

- **How it works:** Server-side + client-side. Injects JS tag that posts device/browser data to `api-js.datadome.co`. Sets `datadome` cookie.
- **Detection signals:** IP reputation (aggressive), JS environment, device fingerprint, geographic anomalies
- **Symptoms:** `403` with `datadome` in response headers, redirect to `geo.captcha-delivery.com` CAPTCHA
- **Transport impact:** Very aggressive -- even `page` transport can fail if the browser profile looks automated. Best results with a real Chrome profile (managed browser auto-copies user's profile).
- **Capture strategy:** Browser auto-starts with real Chrome profile. For manual control, use `openweb browser start --profile <dir>`. Solve any CAPTCHA. Keep sessions short.

## Site-Specific Detection

Some sites roll their own detection in addition to (or instead of) commercial solutions:

| Pattern | Examples | Signal |
|---------|----------|--------|
| Custom request signing | Amazon, LinkedIn, X/Twitter | `x-amzn-*`, custom HMAC, or `x-client-transaction-id` headers computed client-side |
| Custom required headers | Pinterest, Instagram | Requires `x-requested-with: XMLHttpRequest`, `x-pinterest-appstate` (Pinterest) or `x-ig-app-id` (Instagram) -- 400/403 without |
| Encrypted payloads | Google, Facebook | Request body/params are base64/protobuf -- can't be replayed without the encoder |
| Rate-based blocking | Most APIs | `429` or silent empty responses after N requests/minute |
| Rate-based redirect loops | LinkedIn | Rapid sequential node requests trigger redirect loops (>5 redirects) |
| Referrer/origin validation | Many sites | Requests without proper `Referer` or `Origin` header get `403` |
| Cookie chaining | Banking, ticket sites | Multi-step cookie flow -- must visit specific pages in order |

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
```

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

### Generic layer: `detectPageBotBlock()` in `adapter-executor.ts`

Runs **after every `adapter.execute()`** — checks the page for well-known vendor signals:

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
// Example: Redfin rate-limit redirect
if (page.url().includes('ratelimited.')) throw errors.botBlocked('Rate limited by Redfin')
```

Use this for patterns that are **unique to a site** and not covered by the generic layer (e.g., custom rate-limit subdomains, site-specific block pages).

### Adding new patterns

- **Generic layer:** Only add patterns that are (a) from a well-known vendor, or (b) confirmed on a real page during testing. Never guess selectors or title strings.
- **Site layer:** Preferred for site-specific patterns. Check page URL or title inside the adapter's operation handler or `navigateTo()`.

-> See: `src/runtime/adapter-executor.ts` (generic), `src/sites/redfin/adapters/redfin-dom.ts` (site-specific example)
