# Security Taxonomy & Probing Protocol

*Part of the [web-skill design](web-skill-design.md). Referenced by [architecture-pipeline.md](architecture-pipeline.md) Phase 1.5.*

---

## 3.1.5 Phase 1.5: Probe & Classify Execution Requirements

**Goal:** Empirically determine the minimum execution context each endpoint requires across multiple independent security dimensions.

### 3.1.5.1 Website Security Taxonomy

A website's security posture is not a single slider. It's a combination of independent layers, each with its own options. A security architect configures these layers independently; our probing must test them independently too.

**Layer 1: Authentication**

How the server identifies the caller.

| Mechanism | What the server checks | Minimal setup to satisfy | Probeable? |
|---|---|---|---|
| None (public) | Nothing | Bare HTTP | N/A |
| API key | Static key in header/query (`X-API-Key`, `?key=`) | Direct HTTP + key | Yes: try with key |
| Basic Auth | `Authorization: Basic base64(user:pass)` | Direct HTTP + header | Yes: try with header |
| Bearer token (JWT/OAuth) | `Authorization: Bearer <token>` | Direct HTTP + token | Yes: try with token |
| Cookie session | `Cookie: session_id=xxx` | Direct HTTP + cookie | Yes: try without cookie |
| OAuth2 flow (auth code) | Multi-redirect: authorize -> callback -> token | Browser for initial flow; token for subsequent calls | Partially: token refresh may need browser |
| SAML / SSO | Redirect to IdP, assertion post-back | Browser for initial flow | No: must use browser |
| WebAuthn / Passkey | Hardware authenticator challenge-response | Physical device + browser | No: requires human |
| mTLS (client cert) | TLS client certificate | Configured TLS context (any HTTP client) | Yes: try with cert |

**Layer 2: Session Protection**

How the server prevents request forgery and replay.

| Mechanism | What the server checks | Minimal setup to satisfy | Probeable? |
|---|---|---|---|
| None | Nothing | Nothing extra | N/A |
| CSRF synchronizer token | Token from page DOM/meta matches header/body | Fetch page first, extract token, include in request | Yes: try without token |
| Double-submit cookie | CSRF cookie value matches CSRF header value | Include both cookie and matching header | Yes: try without header |
| SameSite cookie | Browser only sends cookie on same-site requests | In-browser fetch (or header manipulation) | Yes: compare same-origin vs cross-origin |
| Origin/Referer check | Server validates `Origin` or `Referer` header | Include correct Origin/Referer header | Yes: try with and without |
| HMAC request signing | `Signature` header = HMAC(secret, canonical_request) | Call the site's signing JS, or reverse-engineer | Partially: detectable from headers |
| Nonce / timestamp | Request includes monotonic nonce or recent timestamp | Generate nonce/timestamp per request | Yes: detectable from request patterns |
| Encrypted payload | Request body is encrypted client-side | Call the site's encryption JS | No: must reverse-engineer or use in-browser |

**Layer 3: Bot Detection**

How the server distinguishes automated clients from real browsers.

| Mechanism | What the server checks | Minimal setup to satisfy | Probeable? |
|---|---|---|---|
| None | Nothing | Bare HTTP | N/A |
| User-Agent check | `User-Agent` header looks browser-like | Set UA header | Yes: trivial |
| Referer/Origin check | Request has plausible Referer | Set Referer header | Yes: trivial |
| JavaScript challenge | Client executes JS and returns computed token | Headless browser (runs JS) | Yes: direct HTTP will fail, browser will pass |
| TLS fingerprint (JA3/JA4) | TLS handshake matches known browser pattern | Real browser (or TLS-mimicking library like `curl-impersonate`) | Yes: compare Node.js vs browser |
| Browser fingerprint | Canvas, WebGL, AudioContext, fonts, screen size | Real browser with realistic hardware profile | Partially: headless may fail |
| Headless detection | `navigator.webdriver`, missing plugins, CDP artifacts | **Headed** browser with stealth patches | Yes: compare headless vs headed |
| CDP detection | Detects Chrome DevTools Protocol connection | Avoid CDP or use indirect control | Difficult: may need alternative automation |
| Behavioral analysis | Mouse movements, typing cadence, scroll patterns, timing | Full UI automation with realistic delays | No: requires sophisticated simulation |

**Layer 4: Human Verification**

How the server ensures a human (not just a browser) is present.

| Mechanism | What the server checks | Minimal setup to satisfy | Probeable? |
|---|---|---|---|
| None | Nothing | Nothing | N/A |
| Invisible CAPTCHA (reCAPTCHA v3, Turnstile) | Risk score from background JS signals | Headless browser (often passes) | Yes: run JS, check if challenge triggers |
| Interactive CAPTCHA (reCAPTCHA v2, hCaptcha) | Human solves visual puzzle | Human handoff | No: requires human |
| SMS/Email OTP | User provides one-time code | Human provides code | No: requires human |
| TOTP (authenticator app) | User provides time-based code | Could automate with TOTP secret | Yes if secret is available |
| Hardware key (FIDO2/WebAuthn) | Physical device signs challenge | Human with device | No: requires physical interaction |

**Layer 5: Network Controls**

How the server restricts at the infrastructure level.

| Mechanism | What the server checks | Minimal setup to satisfy | Probeable? |
|---|---|---|---|
| None | Nothing | Nothing | N/A |
| Rate limiting | Request frequency per IP/session | Respect rate limits, back off on 429 | Yes: detectable from response headers |
| IP reputation | IP against known bot/datacenter lists | Residential IP or user's own IP | Partially: depends on probing IP |
| Session-IP binding | Session cookie only valid from originating IP | Must probe from same IP as recording | Yes: if probe fails but browser works, suspect IP binding |
| Geo-restriction | GeoIP lookup | Proxy in correct region | Partially: may need proxy configuration |
| VPN/proxy detection | Checks if IP belongs to known VPN/datacenter | User's real IP (not VPN) | Yes: but hard to work around |
| WAF rules | Payload pattern matching, header anomalies | Match expected request patterns exactly | Yes: detectable from 403/406 responses |

**Layer 6: Request Integrity**

How the server ensures requests haven't been tampered with.

| Mechanism | What the server checks | Minimal setup to satisfy | Probeable? |
|---|---|---|---|
| None | Nothing | Nothing | N/A |
| HMAC signature | Hash of (secret + canonical request) matches header | Call site's JS signing function, or replicate | Partially: detectable from headers |
| Encrypted payload | Decrypted body matches expected schema | Call site's JS encryption function | No: must use in-browser |
| Request sequence | Requests must follow expected order (state machine) | Respect workflow DAG | Yes: detectable from 409/422 errors |
| Idempotency key | Unique key per request to prevent duplicates | Generate unique key | Yes: detectable from headers/docs |

---

### 3.1.5.2 Security Profile per Endpoint

Instead of a single linear "tier," each endpoint gets a **multi-dimensional security profile** determined by probing each layer independently:

```json
{
  "GET /api/search": {
    "security_profile": {
      "auth": { "mechanism": "cookie_session", "required_cookies": ["session_id"] },
      "session_protection": { "mechanism": "none" },
      "bot_detection": { "mechanism": "none" },
      "human_verification": { "mechanism": "none" },
      "network": { "rate_limit": "100/min", "ip_bound": false },
      "request_integrity": { "mechanism": "none" }
    },
    "execution_strategy": {
      "primary": "session_replay",
      "needs_browser": false,
      "needs_human": false
    }
  },
  "POST /api/cart/add": {
    "security_profile": {
      "auth": { "mechanism": "cookie_session", "required_cookies": ["session_id", "__cf_bm"] },
      "session_protection": { "mechanism": "csrf_synchronizer", "extractor": "csrf-meta-tag.js" },
      "bot_detection": { "mechanism": "cloudflare_js_challenge", "tls_fingerprint": true },
      "human_verification": { "mechanism": "none" },
      "network": { "rate_limit": "20/min", "ip_bound": true },
      "request_integrity": { "mechanism": "none" }
    },
    "execution_strategy": {
      "primary": "headless_browser",
      "needs_browser": true,
      "needs_human": false
    }
  },
  "POST /api/checkout/confirm": {
    "security_profile": {
      "auth": { "mechanism": "cookie_session" },
      "session_protection": { "mechanism": "csrf_synchronizer" },
      "bot_detection": { "mechanism": "cloudflare_js_challenge", "tls_fingerprint": true, "headless_detection": true },
      "human_verification": { "mechanism": "interactive_captcha" },
      "network": { "rate_limit": "5/min", "ip_bound": true },
      "request_integrity": { "mechanism": "hmac_signature" }
    },
    "execution_strategy": {
      "primary": "headed_browser",
      "needs_browser": true,
      "needs_human": true,
      "human_steps": ["solve_captcha"]
    }
  }
}
```

---

### 3.1.5.3 Deriving Execution Strategy from Security Profile

The execution strategy is a **function of the security profile**, not a fixed tier. The rule is: use the cheapest execution mode that satisfies ALL security layers simultaneously.

```
For each endpoint:
  needs_browser = false
  needs_headed  = false
  needs_human   = false

  // Layer 1: Auth
  if auth in [cookie_session, oauth2_flow, saml, webauthn]:
    need cookies/tokens (may or may not need browser)
  if auth in [saml, webauthn]:
    needs_human = true

  // Layer 2: Session Protection
  if session_protection in [csrf_synchronizer, double_submit]:
    need to fetch page and extract token (can do without browser)
  if session_protection in [hmac_signing, encrypted_payload]:
    needs_browser = true  (call site's JS)

  // Layer 3: Bot Detection
  if bot_detection involves [js_challenge, tls_fingerprint]:
    needs_browser = true
  if bot_detection involves [headless_detection, cdp_detection]:
    needs_headed = true   (headless won't pass)
  if bot_detection involves [behavioral_analysis]:
    needs_headed = true
    // may still fail -- best effort

  // Layer 4: Human Verification
  if human_verification in [interactive_captcha, sms_otp, hardware_key]:
    needs_human = true

  // Layer 5: Network
  // Orthogonal: configure proxy/rate-limiting regardless of execution mode

  // Layer 6: Request Integrity
  if integrity involves [hmac_signature, encrypted_payload]:
    needs_browser = true  (call site's JS signing/encryption)

  // Derive execution mode:
  if needs_human:
    mode = "headed_browser_with_human"
  elif needs_headed:
    mode = "headed_browser"
  elif needs_browser:
    mode = "headless_browser"
  elif needs_csrf:
    mode = "session_replay_with_csrf"
  elif needs_cookies:
    mode = "session_replay"
  else:
    mode = "direct_http"
```

---

### 3.1.5.4 Revised Execution Modes

Based on the security taxonomy, the execution modes are:

| Mode | Browser? | Headed? | Human? | Satisfies |
|---|---|---|---|---|
| `direct_http` | No | No | No | Auth: none/apikey/bearer. No bot detection. No CSRF. |
| `session_replay` | No | No | No | Auth: cookie. No CSRF enforcement. No bot detection. |
| `session_replay_with_csrf` | No | No | No | Auth: cookie + CSRF. Bot detection: none or UA-only. |
| `headless_browser` | Yes | No | No | Bot: JS challenge, TLS fingerprint. Integrity: JS signing. |
| `headed_browser` | Yes | Yes | No | Bot: headless detection, CDP detection, behavioral. |
| `headed_browser_with_human` | Yes | Yes | Yes | Human: CAPTCHA, 2FA, hardware key, payment confirmation. |

The key change from the previous design: **`headed_browser`** is a distinct mode between headless and human-assisted. Some sites reject headless Playwright but accept headed Playwright without any human interaction.

---

### 3.1.5.5 Probing Protocol (Revised)

Probing now tests each security dimension independently rather than walking a linear tier chain:

```
For each endpoint:

  1. AUTH PROBE: Does it need cookies?
     - Try without cookies -> success? auth=none
     - Try with session cookie only -> success? auth=cookie_session
     - Try with full cookie jar -> success? auth=cookie_full

  2. CSRF PROBE: Does it need CSRF token?
     (Only if auth probe needed cookies)
     - Try without CSRF token -> success? csrf=not_enforced
     - Try with CSRF token -> success? csrf=required

  3. ORIGIN PROBE: Does it check Referer/Origin?
     - Try without Origin/Referer headers -> success?
     - Try with wrong Origin -> success?
     - Try with correct Origin -> success?

  4. TLS PROBE: Does it check TLS fingerprint?
     - Try from Node.js (non-browser TLS) -> success?
     - Try from curl-impersonate (browser-like TLS) -> success?
     - If both fail -> needs real browser

  5. BOT DETECTION PROBE: (only if TLS probe needed browser)
     - Try headless Playwright -> success?
     - Try headless with stealth patches -> success?
     - Try headed Playwright -> success?
     - If all fail -> site has advanced behavioral detection

  6. WRITE ENDPOINTS: Skip probing, default to headless_browser
     (probing write endpoints has side effects)
```

Each probe is independent: a "cookie=yes, csrf=no, tls=no" site needs `session_replay`, not `headless_browser`. The previous linear chain would have escalated unnecessarily.

**Output:** Per-endpoint security profile + derived execution strategy, stored in `api-map/security-profiles.json`.

---

### 3.1.5.6 Common Real-World Security Configurations

For reference, these are the typical security configurations encountered at scale:

| Site Type | Auth | Session | Bot Detection | Human | Integrity | Typical Execution |
|---|---|---|---|---|---|---|
| Public API (weather, etc.) | API key | None | Rate limit | None | None | `direct_http` |
| Static content site | None | None | None | None | None | `direct_http` |
| SPA + REST backend (basic) | Cookie/JWT | CSRF | None | None | None | `session_replay_with_csrf` |
| SPA + REST (with WAF) | Cookie | CSRF | Cloudflare JS | None | None | `headless_browser` |
| E-commerce (Shopify-tier) | Cookie | CSRF | Cloudflare | CAPTCHA on checkout | None | `headless_browser` (read), `headed_browser_with_human` (buy) |
| Major e-commerce (Amazon) | Cookie | CSRF + signatures | Akamai + TLS fp + headless detect | CAPTCHA + 2FA | HMAC on cart ops | `headed_browser` (read), `headed_browser_with_human` (buy) |
| Travel (Google Flights) | Cookie | CSRF | TLS fingerprint + JS challenge | None (search) | Protobuf encoding | `headless_browser` |
| Social media (logged-in) | Cookie/OAuth | CSRF | Advanced behavioral | CAPTCHA on sign-up | Request signing | `headed_browser` |
| Banking / Financial | Cookie + 2FA | CSRF + nonce | Advanced + CDP detect + behavioral | 2FA on every sensitive op | Full request signing | `headed_browser_with_human` |
| Internal enterprise tools | Cookie/SSO | SameSite | None | None | None | `session_replay` |

This table is what the meta-skill's `knowledge/probe-heuristics.json` evolves toward: a probabilistic mapping from observable site signals to expected security configuration.
