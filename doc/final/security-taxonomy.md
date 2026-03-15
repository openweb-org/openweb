# Security Taxonomy & Probing Protocol

> **Status**: COMPLETE
> **Referenced by**: [compiler-pipeline.md](compiler-pipeline.md) Phase 3, [runtime-executor.md](runtime-executor.md)
> **Mostly unchanged from v1** — updated references and added L1/L2/L3 mapping.

---

## Three-Layer Security Mapping

The v2 three-layer architecture aligns with security concerns:

| Layer | Security handled by | Examples |
|---|---|---|
| **L1** (OpenAPI) | Standard HTTP auth (API key, Bearer, cookies) | Public APIs, OAuth token endpoints |
| **L2** (Primitives) | Browser state extraction + injection: auth tokens from storage, CSRF handling, known signing algorithms | localStorage JWT, cookie-to-header CSRF, SAPISIDHASH |
| **L3** (Adapters) | Obfuscated signing, internal protocols, custom security | OnlyFans signing, WhatsApp protocol, TikTok X-Bogus |

**Security escalation**: L1 has the smallest attack surface (pure HTTP). L2 requires
browser context for extraction but makes requests via HTTP when possible. L3 runs
arbitrary JS in page context — highest capability but highest trust requirement.

See [layer3-code-adapters.md](layer3-code-adapters.md) for L3 security model.

---

## The Observation Paradox

During Phase 1 recording, all traffic runs inside a real browser with full cookies, TLS fingerprint, CSRF tokens, and JavaScript signing. Everything succeeds. **You cannot determine from a set of successes which factors were necessary for success.**

- A request carries 20 cookies. Does the server check all 20, or just `session_id`?
- A request has an `X-CSRF-Token` header. Does the server enforce it for GET requests?
- The browser's TLS fingerprint matches Chrome. Would the server reject a Python `requests` fingerprint?

The only way to know is to **try without and see what breaks.** This is why probing exists.

---

## The Escalation Ladder

For each endpoint, try cheap modes first and escalate on failure:

```
1. Direct HTTP (no cookies, no browser)    → works? mode = direct_http     DONE
2. HTTP + session cookies                  → works? mode = session_http    DONE
3. HTTP + cookies + CSRF token extracted   → works? mode = session_http    DONE
4. Headless browser (in-page fetch)        → works? mode = browser_fetch   DONE
5. Headed browser                          → works? mode = browser_fetch   DONE
6. Needs human                             → set human_handoff = true      DONE
```

This is **≤6 requests per endpoint with early termination.** O(1) probing cost.

Step 1 maps to `direct_http` (no browser process needed at all). Steps 2-3 map to `session_http` (HTTP with cookies from a browser session, but no live page context needed). Steps 4-5 map to `browser_fetch` (in-page `fetch()`, requires live browser page). Step 6 sets the `human_handoff` flag (human must intervene for CAPTCHA, 2FA, payment, etc.).

**Why not per-layer probing:** You don't need to know *which* security layer blocked you. You need to know *what execution mode works*. If direct HTTP fails and headless browser succeeds, you use headless browser. The reason (TLS fingerprint? JS challenge? HMAC signing?) is interesting for the knowledge base (learning) but irrelevant for the execution decision.

The per-layer taxonomy below tells you *why* step 2 failed and step 4 worked. That's useful for learning but not for the probing decision.

---

## Three Execution Modes + Human Handoff Flag

The runtime uses three execution modes plus a boolean flag:

| Mode | What it means | Resource cost | When |
|---|---|---|---|
| `direct_http` | No browser process needed at all. Pure HTTP client. | Lowest — just `fetch()` | Public APIs, stateless REST, API key / bearer token auth |
| `session_http` | HTTP with cookies from a browser session. No live page context. | Low — cookie jar + HTTP client | Cookie-auth REST, sites where CSRF token can be extracted and reused |
| `browser_fetch` | In-page `fetch()` in a live browser page context. | Higher — browser page must be loaded | CSRF bound to page, JS challenges, TLS fingerprint, signed payloads |

| Flag | What it means |
|---|---|
| `human_handoff` | Tool may require human intervention (CAPTCHA, 2FA, payment). Runtime pauses and prompts user. |

**Why `session_http` is a separate mode:** `direct_http` requires no browser at all — it can run purely with `node-fetch`. `session_http` needs cookies managed by a browser session (user must have logged in), but the actual API request can be made outside the browser page context. This is cheaper than `browser_fetch` (no page loaded) but requires a running browser process for cookie management. The distinction matters for resource allocation, concurrency, and latency.

**Why `human_handoff` is a flag, not a mode:** A tool classified as `browser_fetch` might occasionally trigger a CAPTCHA. A payment tool always needs human confirmation. The flag is orthogonal to the execution mode — it describes a capability constraint, not a transport mechanism.

---

## Probing Safety

- **Write endpoints:** Skip probing entirely. Default to `browser_fetch`. Probing write endpoints causes real side effects.
- **Rate limiting:** Space probes with respectful delays. Max 5-6 probes per endpoint. Global limit of ~120 probe requests per site.
- **Ambiguity (`unknown` state):** A 403 could mean "security layer blocked you" or "endpoint doesn't exist" or "rate-limited." When ambiguous, mark as `unknown` and escalate to the next mode. Better safe than slow.
- **Knowledge base acceleration:** If heuristics say "Cloudflare sites need `browser_fetch` in 94% of cases," start probing at step 4 instead of step 1. This is an optimization — always confirm empirically.
- **Probe budget:** Each endpoint gets a hard cap on probe attempts. Don't burn the session.
- **SSRF protection:** Every outbound request during probing (and later during execution) passes through mandatory SSRF validation: hostname validation → DNS resolution → private IP rejection → metadata endpoint blocking (`169.254.169.254`). Applied on all `fetch()` calls including redirect targets. This is non-negotiable — the executor takes user-provided parameters and constructs HTTP requests.

---

## Risk Classification

Every endpoint receives a deterministic risk tier during Phase 3, stored in `x-openweb.risk_tier`:

| Condition | Tier |
|---|---|
| Auth-related path (`/login`, `/oauth`, `/token`, `/session`) | critical |
| Payment/billing paths (`payment`, `checkout`, `billing`, `refund`) | critical |
| Destructive paths (`delete`, `destroy`, `revoke`, `terminate`) | high |
| HTTP DELETE | high |
| POST/PUT/PATCH with PII fields | high |
| POST/PUT/PATCH (no PII) | medium |
| GET with PII in response | low |
| Everything else (GET, read-only) | safe |

**PII detection heuristic:** field name contains `email`, `phone`, `ssn`, `password`, `credit_card`, `address`, `name` (when not a product/category name).

Risk tier drives runtime behavior:

| Tier | Confirmation | Rate limit | Self-heal publish |
|---|---|---|---|
| safe | None | 120/min | Auto if tests pass |
| low | None | 60/min | Auto if tests pass |
| medium | Once per session | 30/min | Human approval |
| high | Every invocation | 10/min | Human approval |
| critical | Every invocation with details | 5/min | Human approval |

---

## Probe Result Caching & TTL

- Probe results are stored in the operation's `x-openweb.mode` field in `openapi.yaml`.
- Results become stale when the site fingerprint changes or when runtime fallbacks consistently escalate beyond the classified mode.
- **Re-probing triggers:** Fingerprint drift detected, or tool fails at classified mode 3+ times with success at a higher mode.
- Re-probing is incremental: only re-test the specific endpoint, not the whole site.

---

## 6-Layer Website Security Taxonomy (Reference)

This taxonomy is **reference documentation** for building intuition about website security. It is NOT used directly by the probing implementation — the escalation ladder above is the implementation.

### Layer 1: Authentication

How the server identifies the caller.

| Mechanism | Minimal setup to satisfy | Probeable? |
|---|---|---|
| None (public) | Bare HTTP | N/A |
| API key | Direct HTTP + key | Yes |
| Basic Auth | Direct HTTP + header | Yes |
| Bearer token (JWT/OAuth) | Direct HTTP + token | Yes |
| Cookie session | Direct HTTP + cookie | Yes |
| OAuth2 flow (auth code) | Browser for initial flow; token for subsequent | Partially |
| SAML / SSO | Browser for initial flow | No: must use browser |
| WebAuthn / Passkey | Physical device + browser | No: requires human |

### Layer 2: Session Protection

How the server prevents request forgery and replay.

| Mechanism | Minimal setup to satisfy | Probeable? |
|---|---|---|
| None | Nothing extra | N/A |
| CSRF synchronizer token | Fetch page, extract token, include in request | Yes |
| Double-submit cookie | Include both cookie and matching header | Yes |
| SameSite cookie | In-browser fetch | Yes |
| Origin/Referer check | Include correct Origin/Referer header | Yes |
| HMAC request signing | Call site's signing JS | Partially |
| Encrypted payload | Call site's encryption JS | No: must use in-browser |

### Layer 3: Bot Detection

How the server distinguishes automated clients from real browsers.

| Mechanism | Minimal setup to satisfy | Probeable? |
|---|---|---|
| None | Bare HTTP | N/A |
| User-Agent check | Set UA header | Yes: trivial |
| JavaScript challenge | Headless browser (runs JS) | Yes |
| TLS fingerprint (JA3/JA4) | Real browser or TLS-mimicking library | Yes |
| Browser fingerprint (Canvas, WebGL) | Real browser with realistic profile | Partially |
| Headless detection (`navigator.webdriver`) | Headed browser with stealth patches | Yes |
| CDP detection | Avoid CDP or use indirect control | Difficult |
| Behavioral analysis (mouse, typing) | Full UI automation with realistic delays | No |

### Layer 4: Human Verification

| Mechanism | Minimal setup | Probeable? |
|---|---|---|
| None | Nothing | N/A |
| Invisible CAPTCHA (reCAPTCHA v3, Turnstile) | Headless browser (often passes) | Yes |
| Interactive CAPTCHA (reCAPTCHA v2, hCaptcha) | Human solves puzzle | No: requires human |
| SMS/Email OTP | Human provides code | No: requires human |
| Hardware key (FIDO2/WebAuthn) | Physical device | No: requires physical |

### Layer 5: Network Controls

| Mechanism | Minimal setup | Probeable? |
|---|---|---|
| Rate limiting | Respect rate limits, back off on 429 | Yes |
| IP reputation | Residential IP or user's own IP | Partially |
| Session-IP binding | Probe from same IP as recording | Yes |
| Geo-restriction | Proxy in correct region | Partially |
| WAF rules | Match expected request patterns | Yes |

### Layer 6: Request Integrity

| Mechanism | Minimal setup | Probeable? |
|---|---|---|
| HMAC signature | Call site's JS signing function | Partially |
| Encrypted payload | Call site's JS encryption | No: must use in-browser |
| Request sequence | Respect workflow DAG ordering | Yes |
| Idempotency key | Generate unique key per request | Yes |

---

## Common Real-World Security Configurations

| Site Type | Typical Execution Mode |
|---|---|
| Public API, static sites | `direct_http` |
| SPA + REST (basic) | `direct_http` (with cookies + optional CSRF) |
| SPA + WAF (Cloudflare) | `browser_fetch` |
| E-commerce (Shopify-tier) | `browser_fetch` (read), `browser_fetch` + `human_handoff` (checkout) |
| Major e-commerce (Amazon) | `browser_fetch` (read), `browser_fetch` + `human_handoff` (purchase) |
| Travel (Google Flights) | `browser_fetch` |
| Social media (logged-in) | `session_http` / `browser_fetch` (endpoint-dependent) |
| Banking / Financial | `browser_fetch` + `human_handoff` for sensitive operations |
| Internal enterprise tools | `session_http` (cookie session), fallback `browser_fetch` |

This table is what the self-evolution system's heuristics evolve toward: a probabilistic
mapping from observable site signals to expected execution mode.
See [self-evolution.md](self-evolution.md).

---

## Cross-References

- **Probing implementation** → [compiler-pipeline.md](compiler-pipeline.md): Phase 3 probing + pattern matching
- **Risk tier enforcement** → [runtime-executor.md](runtime-executor.md): Rate limiting, confirmation prompts
- **L2 primitive security** → [layer2-interaction-primitives.md](layer2-interaction-primitives.md): Auth/CSRF/signing
- **L3 adapter security** → [layer3-code-adapters.md](layer3-code-adapters.md): Trust model, execution boundary
- **SSRF protection** → [runtime-executor.md](runtime-executor.md): URL validation
