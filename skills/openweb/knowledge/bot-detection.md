# Bot Detection Patterns

> **Scope: legitimate site interoperability for the logged-in user.** Modern bot-detection systems (Cloudflare, Akamai, PerimeterX, etc.) sometimes block legitimate browser API calls — including ones the same user could make manually in their own browser — based on TLS fingerprint, sensor freshness, or request shape. This document explains how those systems work so OpenWeb can route through the right transport (HTTP / browser-fetch / DOM `page.evaluate`) and reuse the user's already-established browser session. It is not guidance for circumventing access controls, ToS, or accounts the user does not own. Equivalent technical content appears in `playwright`, `puppeteer-extra-plugin-stealth`, `patchright`, and `yt-dlp` source.

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
| Rate-based blocking | Most APIs | `429` or silent empty responses after N requests/minute. Site-specific 429s may be header/fingerprint validation misclassified as rate limits (e.g., Walmart 429 was Akamai header-bundle fingerprinting, not quota; Spotify 429 was gateway-classification spclient vs api.spotify.com) — verify against current site state. |
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
                                +- Yes -> adapter with page.request.fetch (e.g. Costco read ops; cart writes switch to page.evaluate(fetch()) due to Akamai header-bundle fingerprinting)
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

### Dispatch-Events Pattern (when the SPA itself solves a per-request challenge)

A stronger variant of the intercept pattern: when the API call is gated
by a **per-request token the SPA computes inline** (Sentinel chat-requirements,
proof-of-work, Arkose, hCaptcha tokens minted on send), even
`page.evaluate(fetch)` from the live page returns 403 because the
challenge solver lives inside an event handler that only runs in
response to real user input.

**Symptom:** Both Node fetch AND `page.evaluate(fetch)` return identical
`403` payloads ("Unusual activity detected", "Bot challenge failed",
PoW-related error codes), even with a freshly-warmed page that just
loaded successfully.

**Fix:** Drive the SPA's own UI handler with synthesized input events,
let the page solve the challenge, and intercept the resulting response
off the wire. Avoid DOM clicks (brittle, can be detected) — use
`focus()` + `page.keyboard.type` + `page.keyboard.press('Enter')`:

```typescript
// Listener registered BEFORE the keypress so an early response is not missed
let bodyPromise: Promise<string> | null = null
page.on('response', (resp) => {
  if (!bodyPromise && /\/api\/send-endpoint/.test(resp.url())) {
    bodyPromise = resp.text().catch(() => '')
  }
})

// Focus + type + submit — no clicks
await page.evaluate((sel) => (document.querySelector(sel) as HTMLElement)?.focus(), '#composer')
await page.keyboard.type(prompt)
await page.keyboard.press('Enter')

// Wait for the SPA's own fetch to resolve
const body = await bodyPromise
```

**Why this beats reimplementing the challenge:**
- PoW algorithms rotate (OpenAI changes seed format / difficulty). Adapter
  re-implementations break silently.
- Tokens often bind to ephemeral browser state (canvas/WebGL fingerprint,
  recent mouse events, IndexedDB entries) that's expensive or
  impossible to reproduce outside the live page.
- Intercept-only (Path B in adapter triage) doesn't work because tokens
  are one-shot per request — observing one send doesn't unlock the next.

**Pitfalls:**
- Modern composers are often **ProseMirror / Lexical / Slate
  `contenteditable` divs**, not `<input>` / `<textarea>`. `el.value = …`
  is a no-op and `el.textContent = …` won't fire the input events the
  framework listens for. Only `page.keyboard.type` (or a real
  `dispatchEvent(new InputEvent(…))` sequence) updates editor state.
- Listener URL match must exclude prepare/precheck endpoints — many SPAs
  hit `/api/send/prepare` first to mint a per-turn token, then open the
  real streaming endpoint. A naïve prefix match captures the prepare
  response and misses the actual data.
- Playwright's `Response.text()` resolves on response headers, not on
  stream end. In practice, `Response.text()` works on SSE if the body
  is fully sent before the await (e.g., `chatgpt-web` uses this pattern).
  CDP `Network.dataReceived` buffered until `Network.loadingFinished`
  is safer for streaming responses arriving incrementally.
- The site may also classify the response with a `403` that the runtime
  treats as `needs_login` (`getHttpFailure(403)` in `src/lib/errors.ts`).
  When this triggers an unwanted login cascade, fail fast with a
  body-content classifier instead of looping.

**Real example:** `src/sites/chatgpt/adapters/chatgpt-web.ts` — chatgpt's
`POST /backend-api/f/conversation` is gated by a Sentinel
chat-requirements token + SHA3-512 PoW. The adapter focuses
`#prompt-textarea` (ProseMirror), types via `page.keyboard.type`, presses
Enter, and intercepts the SSE response — no PoW reimplementation, no
DOM clicks, no PoW seed/difficulty handling.

**Second example:** `src/sites/youtube/adapters/youtube-innertube.ts` —
YouTube's like / comment / delete-comment endpoints are gated by Chrome's
`x-browser-validation` header (TLS-bound, only attached to UI-initiated
requests). Adapter clicks the like button / composer / kebab via Playwright
and intercepts the InnerTube responses.

### Polymer / Web-Component UI Quirks

Sites built on Polymer / Lit (YouTube, parts of Google Photos) bind handlers
in ways that don't tolerate `page.evaluate(el.click())`. When driving such
a SPA from an adapter:

- **Use Playwright `.click()`, not JS `.click()`.** Polymer dialog
  handlers (`tp-yt-paper-dialog`, `ytd-menu-navigation-item-renderer`)
  fire only on the full pointer-event sequence Playwright synthesizes —
  JS `el.click()` from `page.evaluate` does nothing. Get a handle via
  `evaluateHandle(...).asElement()` and call `.click()` on it.
- **`state: 'attached'` for any popup wait.** Popups render with
  `max-height: 0` until the open animation completes — `state: 'visible'`
  hangs even though the element is in the DOM.
- **`scrollIntoView` on the section container, not fixed-pixel `scrollTo`.**
  Lazy-loaded sections (comments, replies, rails) hydrate when scrolled
  into view — `document.querySelector('<container>')?.scrollIntoView()`
  is layout-independent; `scrollTo(0, 700)` overshoots/undershoots.

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

## Diagnostic pitfall: "Target page/context/browser has been closed"

This Playwright error from a clean isolated retest does **not** automatically mean a `browser-fetch-executor.ts` race or a `page-candidates.ts` lifecycle bug. The most common real cause is **orphan-Chrome split-brain**: a prior `verify` loop hit a wrapper timeout (`/tmp/run_with_timeout.sh`) that killed the parent `pnpm` PID but left the spawned Chrome on port 9222. The next session's page-candidates picks the wrong context and `page.evaluate` fails mid-call.

Before classifying as a runtime bug, always cycle:

```bash
openweb browser stop
pkill -9 -f openweb-profile-
openweb browser start
```

Then re-run the failing op in isolation. If it still fails, then investigate `browser-fetch-executor.ts` / `page-candidates.ts`. See `src/sites/walmart/PROGRESS.md` and `src/sites/xiaohongshu/PROGRESS.md` for worked examples (walmart/searchProducts + xiaohongshu/getRelatedNotes both turned out to be this, not a runtime bug).
