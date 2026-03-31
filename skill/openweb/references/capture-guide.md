# Capture Guide

Techniques for capturing site traffic effectively: browsing strategies, direct
API calls, auth injection, scripted capture, multi-worker sharing, and
troubleshooting.

## When to Load This

- `discover.md` Step 2 — during navigate and capture
- When writing or debugging capture scripts
- When setting up multi-worker capture

---

## Capture Modes

Both modes produce HAR traffic that the compiler ingests. Use them together
in each capture session — UI browsing discovers endpoints you don't know about;
direct calls fill known coverage gaps.

### UI Navigation

Browse the site systematically in the managed browser to trigger each target intent:
- Do a search (triggers search API)
- Click into a result (triggers detail API)
- Scroll or paginate (triggers pagination)
- Check other features (reviews, profile, settings)

Tips:
- **Vary your inputs** — use 2-3 different search terms for better schema inference.
- **Wait for content to load** before navigating away.
- **Click through UI tabs** on profiles and feeds — each tab triggers a different
  API endpoint. Hit the top 2-3 tabs.
- **Search: use the on-page search box**, not URL navigation. `page.goto()` to
  a search URL delivers SSR HTML; typing in the SPA search widget triggers the
  JSON API endpoint.
- **If the site requires login**, log in in the managed browser. For net-new
  sites, `openweb login <site>` won't work — authenticate via the target URL
  directly. Existing Chrome profile logins may carry over.
- **Trigger write actions** after browsing read flows: like a post, follow a user,
  bookmark content. See `discover.md` Write Operation Safety table for safe actions.

  **Executing write actions programmatically:**

  *Approach 1 — Click UI buttons* (when selectors are findable):
  Navigate to a content detail page. Find the button using common selectors
  (`[class*="like"]`, `[aria-label*="like"]`, `[data-action="like"]`), scroll it
  into view, click, wait 2s for the POST to fire. If `.click()` doesn't trigger
  the API call, try `dispatchEvent(new MouseEvent('click', {bubbles: true}))`.

  *Approach 2 — Call write APIs directly* (preferred — see Direct API Calls below):
  Use `page.evaluate(fetch('/api/endpoint', {method:'POST', credentials:'same-origin'}))`.
  Read the CSRF token from `document.cookie` if the site uses CSRF. Find write
  endpoint paths in the site's prior-round DOC.md or openapi.yaml — write
  endpoints cannot be discovered from read traffic alone.

  After each write action, trigger the reverse to capture both sides (like/unlike,
  follow/unfollow, bookmark/unbookmark).
- **If you expect auth-required operations:** Log in FIRST, then capture.
  Auth detection requires seeing auth tokens in the traffic. Specifically:
  - **exchange_chain (Reddit-like):** Do a COLD page load (clear cookies or
    incognito) so the token exchange request appears in the HAR.
  - **sapisidhash (Google/YouTube):** Must be logged into a Google account.
    SAPISID cookie and `SAPISIDHASH` Authorization headers must appear in HAR.
  - **cookie_session with CSRF:** Perform at least one mutation (like, follow)
    so the CSRF token appears in POST request headers.
- **Avoid** logout, delete account, billing, irreversible actions.

**SPA navigation rule:** Use **in-app navigation** (click links in the UI), not
address-bar navigation or `window.location.href`. Full-page reloads deliver data
via SSR — JSON API calls only fire during SPA client-side routing. For
programmatic browsing: `element.click()` on links, not `Page.navigate`.

### Direct API Calls via `page.evaluate(fetch)`

Calling APIs directly from the page context is often the most reliable capture
method — more reliable than hoping UI clicks trigger the right requests:

```javascript
await page.evaluate(() => fetch('/api/endpoint?param=value', {
  credentials: 'same-origin'
}));
```

**When to prefer direct fetch over SPA navigation:**
- POST-based APIs (Innertube, GraphQL) — clicks may not send the right body
- You know the API pattern but can't find the UI button
- You want multiple samples with varied parameters for better schema inference
- REST endpoints are more stable than GraphQL `doc_id` hashes

**Combine with UI browsing:** Direct calls fill known coverage gaps; UI browsing
discovers endpoints you don't know about. Use both in each capture session.

**Same-origin only.** `page.evaluate(fetch(...))` is blocked by CORS for
cross-origin URLs. Navigate to the target subdomain first, then use relative paths.

---

## Non-Cookie Auth Injection

`credentials: 'same-origin'` only carries cookie-based auth. For sites using
non-cookie auth (`webpack_module_walk`, `localStorage_jwt`, `page_global`),
you must extract the token and inject it as a header:

```javascript
// Extract token (method depends on auth type)
const token = await page.evaluate(() => {
  // localStorage_jwt:
  return localStorage.getItem('auth_token');
  // page_global:
  // return window.__AUTH_TOKEN__;
});

// Inject into fetch
await page.evaluate((t) => fetch('/api/endpoint', {
  headers: { 'Authorization': `Bearer ${t}` },
}), token);
```

Check the site's `openapi.yaml` auth config to determine the correct extraction
method and header name.

---

## Capture Target Binding

Capture is **browser-wide**, not single-tab. On start, it attaches HAR + WS
recording to `pages()[0]`, then auto-attaches to every new tab opened
afterwards via `context.on('page')`. Pre-existing tabs (opened before capture
started) are NOT monitored, except `pages()[0]`.

What this means in practice:
1. **Start capture FIRST**, then open new tabs — they auto-attach.
2. **Pre-existing tabs are blind spots.** If you opened tabs before capture,
   their traffic won't appear in the HAR.
3. **`page.evaluate(fetch(...))` works** on any monitored page — the initial
   page or any tab opened after capture started.
4. **Separate Playwright connections don't work.** A `page.evaluate(fetch())`
   on a Page from a different Playwright `connect()` call uses a Page object
   that capture doesn't monitor. Use CDP on the existing browser context, or
   navigate in a tab that capture already tracks.

**Verification:** After capture, check `summary.byCategory.api`. If it's 0
despite browsing, traffic likely came from a pre-existing tab or a separate
Playwright connection.

---

## Scripted Capture

For complex programmatic capture (many endpoints, varied parameters), use a
two-phase approach instead of inline `page.evaluate` calls:

1. **Phase 1 — Capture:** `openweb capture start` → run your script → `openweb capture stop`
2. **Phase 2 — Compile:** `openweb compile <site-url> --capture-dir ./capture`

This separates capture from compilation, giving you direct stderr visibility
during the script phase and allowing fast iteration without restarting the
full pipeline.

### Timeout Discipline

Every async operation needs a bounded timeout. Scripts interact with a live
browser via CDP — any async operation can block indefinitely.

**Hard defense:** `compile --script` kills the child process after 120 seconds
(SIGTERM, then SIGKILL after 5s grace). But two-phase scripts (`capture start`
→ run script → `capture stop`) have no such guard — they run in your shell.
Either way, scripts should be self-bounding.

| Operation | Pattern | Why |
|-----------|---------|-----|
| `page.goto()` | `{ waitUntil: 'load', timeout: 30_000 }` | Never use `'networkidle'` — SPAs keep making requests indefinitely |
| `page.evaluate(fetch(...))` | `AbortController` with 15s timeout inside the evaluate | Network stalls or rate limits can block forever |
| `page.close()` / `browser.close()` | `Promise.race([p, sleep(5000)])` | CDP session issues can hang close |
| `session.done` | Already bounded (3s drain timeout internally) | Safe as-is |

#### `networkidle` is never safe for SPAs

`waitUntil: 'networkidle'` waits until there are no more than 0-2 network
connections for 500ms. SPAs like Discord, Reddit, and YouTube maintain
persistent WebSocket connections and periodic XHR polling — networkidle
never fires. Use `'load'` and add a fixed `await wait(3000-5000)` after
for SPA hydration.

#### Fetch timeout inside `page.evaluate`

`page.evaluate` runs code in the browser context. The only way to timeout
a fetch inside it is `AbortController` — Node.js timeouts don't reach into
the browser:

```typescript
await page.evaluate(async (args) => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const r = await fetch(args.url, {
      headers: args.headers,
      signal: ctrl.signal,
    })
    return { status: r.status, body: await r.text() }
  } finally {
    clearTimeout(timer)
  }
}, { url, headers })
```

#### Bounded cleanup

`page.close()` and `browser.close()` can hang if the CDP session is in a
bad state. Wrap them, and **always end with `process.exit(0)`** — the
`setTimeout` inside `withTimeout` keeps the Node.js event loop alive,
preventing natural exit:

```typescript
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | void> =>
  Promise.race([p.catch(() => {}), new Promise<void>((r) => setTimeout(r, ms))])

await withTimeout(page.close(), 5_000)
await withTimeout(browser.close(), 5_000)
process.exit(0)
```

### Two-Phase Capture Script Template

For use with `openweb capture start` → script → `openweb capture stop`:

```typescript
import { chromium } from 'playwright'

const cdpEndpoint = `http://localhost:${process.env.OPENWEB_CDP_PORT ?? '9222'}`
const browser = await chromium.connectOverCDP(cdpEndpoint)
const context = browser.contexts()[0]!
const page = context.pages()[0]!  // use the page capture is already monitoring

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Navigate — use 'load', never 'networkidle'
await page.goto('https://example.com', { waitUntil: 'load', timeout: 30_000 })
await wait(3000)

// Authenticated fetch helper with timeout
async function apiFetch(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return page.evaluate(async (args) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const r = await fetch(args.path, {
        headers: args.headers,
        credentials: 'same-origin',
        signal: ctrl.signal,
      })
      return { status: r.status, body: await r.text() }
    } finally {
      clearTimeout(timer)
    }
  }, { path, headers })
}

// Capture traffic
await apiFetch('/api/v1/users/me')
await wait(800)
await apiFetch('/api/v1/feed?limit=20')
await wait(800)

// Cleanup
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | void> =>
  Promise.race([p.catch(() => {}), new Promise<void>((r) => setTimeout(r, ms))])
await withTimeout(browser.close(), 5_000)
process.exit(0)
```

### `compile --script` Recording Template

For use with `openweb compile <url> --script ./record.ts`:

```typescript
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { createCaptureSession } from '../src/capture/session.js'

const { values } = parseArgs({ options: { out: { type: 'string' } }, strict: false })
const outputDir = values.out
if (!outputDir) { process.stderr.write('Usage: --out <dir>\n'); process.exit(1) }

const cdpEndpoint = `http://localhost:${process.env.OPENWEB_CDP_PORT ?? '9222'}`
const browser = await chromium.connectOverCDP(cdpEndpoint)
const context = browser.contexts()[0]!
const page = await context.newPage()

const session = createCaptureSession({
  cdpEndpoint,
  outputDir,
  targetPage: page,
  isolateToTargetPage: true,
  onLog: (msg) => process.stderr.write(`${msg}\n`),
})
await session.ready

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Navigate — use 'load', never 'networkidle'
await page.goto('https://example.com', { waitUntil: 'load', timeout: 30_000 })
await wait(3000)

// ... extract tokens, call APIs (same apiFetch helper as above) ...

// Cleanup with bounded timeouts
session.stop()
await session.done
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | void> =>
  Promise.race([p.catch(() => {}), new Promise<void>((r) => setTimeout(r, ms))])
await withTimeout(page.close(), 5_000)
await withTimeout(browser.close(), 5_000)
process.exit(0)
```

**Note:** `compile --script` kills the child process after 120 seconds.
Design scripts to complete well within this window.

---

## Multi-Worker Browser Sharing

Multiple workers can share one Chrome browser on the same CDP port. Each
worker starts its own **isolated** capture session — no cross-contamination.

```bash
# Worker A (discovering discord.com)
SESSION_A=$(openweb capture start --isolate --url https://discord.com --cdp-endpoint http://localhost:9222)
# browse discord in the auto-opened tab, or use page.evaluate(fetch) in a script
openweb capture stop --session $SESSION_A
openweb compile https://discord.com --capture-dir ./capture-$SESSION_A

# Worker B (discovering reddit.com) — simultaneously
SESSION_B=$(openweb capture start --isolate --url https://reddit.com --cdp-endpoint http://localhost:9222)
# browse reddit
openweb capture stop --session $SESSION_B
openweb compile https://reddit.com --capture-dir ./capture-$SESSION_B
```

Key points:
- `--isolate` creates a new tab and monitors only that tab's traffic
- Each session gets a unique ID printed to stdout and a session-scoped PID file
- `capture stop --session <id>` stops a specific session without affecting others
- Output directories are auto-scoped: `./capture-<session-id>/`
- Without `--isolate`, capture is browser-wide (single-worker interactive use)

---

## Capture Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| HAR has 0 API entries for target site | Browsing happened in a pre-existing tab (opened before capture) | Start capture first, then open a NEW tab for the site |
| `page.evaluate(fetch())` not in HAR | Fetch ran on a Page from a separate Playwright connection | Use CDP on the capture's browser context, or navigate a monitored tab |
| `No active capture session` on stop | Stale PID file or process killed | `pkill -f "capture start"`, delete PID file, restart |
| HAR empty / truncated | Process killed before flush | Stop with `openweb capture stop`, never `kill -9` |
| Another worker's stop kills your data | Global capture stop | Use Playwright `context.recordHar()` for isolated capture |

---

## Related References

- `references/discover.md` — discovery process that invokes capture at Step 2
- `references/compile.md` — post-capture process
- `references/knowledge/bot-detection-patterns.md` — capture strategy per detection level
- `references/knowledge/auth-patterns.md` — auth types affecting capture approach
