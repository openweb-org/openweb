# Bot Detection Patterns

How major bot detection systems work, their impact on openweb transport and capture strategy, and known workarounds.

## Detection Systems

### Cloudflare (Turnstile / Bot Management)

- **How it works:** JavaScript challenge on first visit sets `cf_clearance` cookie. Managed challenge or Turnstile widget on suspicious requests. Server-side rate limiting with `429` + `Retry-After`.
- **Detection signals:** TLS fingerprint (JA3), IP reputation, browser automation markers (`navigator.webdriver`), request rate
- **Symptoms:** `403` with Cloudflare challenge page, `429` rate limit, redirect to `/cdn-cgi/challenge-platform/`
- **Impact on transport:** Node transport fails without valid `cf_clearance` — must use `page` transport or extract cookie from browser session
- **Capture strategy:** Start browser, solve challenge manually, then begin capture. The clearance cookie has a TTL (usually 30min–2h).

### Akamai (Bot Manager)

- **How it works:** Client-side sensor script (`_abck` cookie) fingerprints browser. Server checks sensor data on each request.
- **Detection signals:** JavaScript execution environment, mouse/keyboard events, canvas fingerprint, WebGL, sensor data freshness
- **Symptoms:** `403` with empty or generic error body, `_abck` cookie with `~0~` (invalid sensor), request succeeds in browser but fails in Node
- **Impact on transport:** Node transport almost never works. Must use `page` transport with real browser.
- **Capture strategy:** Record in a real browser session. The `_abck` cookie refreshes frequently — capture sessions should be short.

### PerimeterX (HUMAN Security)

- **How it works:** Client-side script sets `_px3` / `_pxhd` cookies. Server validates on each request. Block page uses a challenge (press-and-hold, CAPTCHA).
- **Detection signals:** similar to Akamai — JS environment, event patterns, cookie freshness
- **Symptoms:** `403` with JSON `{"appId":"PX...","vid":"...","uuid":"..."}`, block page HTML with `/captcha/` path
- **Impact on transport:** Node transport fails. `page` transport works if the browser has solved the initial challenge.
- **Capture strategy:** Same as Akamai — real browser, short sessions.

### DataDome

- **How it works:** Server-side + client-side. Injects a JS tag that posts device/browser data to `api-js.datadome.co`. Sets `datadome` cookie.
- **Detection signals:** IP reputation (aggressive), JS environment, device fingerprint, geographic anomalies
- **Symptoms:** `403` with `datadome` in response headers, redirect to `geo.captcha-delivery.com` CAPTCHA
- **Impact on transport:** Very aggressive — even `page` transport can fail if the browser profile looks automated. Best results with a real Chrome profile (`browser start` copies the user's profile).
- **Capture strategy:** Use `openweb browser start` (copies real profile). Solve any CAPTCHA. Keep sessions short.

## Site-Specific Detection

Some sites roll their own detection in addition to (or instead of) commercial solutions:

| Pattern | Examples | Signal |
|---------|----------|--------|
| Custom request signing | Amazon, LinkedIn | Requests include `x-amzn-*` or custom HMAC headers computed client-side |
| Encrypted payloads | Google, Facebook | Request body or params are base64/protobuf — can't be replayed without the encoder |
| Rate-based blocking | Most APIs | `429` or silent empty responses after N requests/minute |
| Referrer/origin validation | Many sites | Requests without proper `Referer` or `Origin` header get `403` |
| Cookie chaining | Banking, ticket sites | Multi-step cookie flow — must visit specific pages in order |

## Impact on Transport Selection

```text
Can Node make the request without auth cookies?
  ├─ Yes → node transport (fastest, simplest)
  └─ No → Does the site use bot detection?
       ├─ No/light (Cloudflare basic) → node + browser cookie extraction
       └─ Heavy (Akamai/PX/DataDome/custom) → page transport
            └─ Does page need specific JS context?
                 ├─ No → page transport with evaluate
                 └─ Yes → adapter transport
```

## Impact on Capture Strategy

| Detection level | Capture approach |
|----------------|-----------------|
| None | Headless browser or node proxy — anything works |
| Light (Cloudflare basic) | Headed browser, solve challenge once, capture |
| Medium (Akamai, PerimeterX) | Real Chrome profile (`browser start`), short sessions, don't replay requests |
| Heavy (DataDome, custom signing) | Real profile, manual browsing, record passively, extract patterns from traffic |

## General Principles

1. **Never fight the detection system** — work within the browser where detection is already solved
2. **Prefer `page` transport** when in doubt — it inherits all browser state
3. **Keep capture sessions short** — most tokens/sensors expire in 5–30 minutes
4. **Use `openweb browser start`** — it copies the real Chrome profile, which has history/cookies that look legitimate
5. **Don't replay raw requests** — extract the pattern (URL, params, headers) and let the transport regenerate auth headers
6. **Rate limit operations** — even with valid auth, high request rates trigger server-side blocking
7. **Document detection in DOC.md** — if a site uses bot detection, note the system and its impact in the site package's Known Issues section

## Related References

- `references/discover.md` — Browser First rule, capture strategy
- `references/compile.md` — transport decision model
- `knowledge/extraction-patterns.md` — extraction alternatives when APIs are blocked
- `knowledge/troubleshooting-patterns.md` — bot detection failure patterns
