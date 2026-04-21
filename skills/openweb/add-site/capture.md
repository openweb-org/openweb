# Capture Techniques

How to capture site traffic for the compiler. Interactive browsing, direct API
calls, scripted capture, auth injection, and troubleshooting.

**Load when:** guide.md Step 4 (Capture Evidence), or when debugging capture scripts.

---

## Capture Modes

Both modes produce HAR traffic. Use them together — UI browsing discovers
endpoints you don't know about; direct calls fill known coverage gaps.

### Capture Granularity

Probe determines how much capture each intent family needs. Capture is not a
repeat of probe — it is compile's input. When compile adds no value for a
family, capture adds no value either.

| Mode | When to use | Typical scope |
|------|-------------|---------------|
| **None** | Pure extraction or direct adapter/intercept; compile adds no value | Skip capture entirely |
| **Micro** | Endpoint already known; compile saves manual schema/example/auth work | 1-3 representative requests |
| **Targeted** | Family needs param variation, GraphQL clustering, path normalization | Focused family capture with varied actions |
| **Broad** | Surface still unknown after probe, WS discovery, many unknown ops | Large-surface capture |

Broad capture is not the default. Use it only when micro or targeted did not
produce enough evidence, the surface is still unknown, or WS discovery needs
longer observation.

**Probe drives capture scope:** Use the family's capture mode from the probe
matrix to select granularity. Avoid blind browsing — capture only the traffic
needed for the decision being answered.

### UI Navigation

Browse the managed browser systematically to trigger each target intent:

- **Search:** Type in the on-page search box, not the URL bar. `page.goto()`
  to a search URL delivers SSR HTML; the SPA search widget triggers the JSON API.
- **Vary inputs** — 2-3 different search terms for better schema inference.
- **Click through results** — detail pages, tabs, pagination.
- **Wait for content to load** before navigating away.
- **Click UI tabs** on profiles/feeds — each triggers a different endpoint.

**SPA navigation rule:** Use in-app navigation (click links), not address-bar
navigation or `window.location.href`. Full-page reloads deliver SSR data — JSON
API calls only fire during SPA client-side routing. For programmatic browsing:
`element.click()` on links, not `Page.navigate`.

#### Login

If login required, authenticate in the managed browser. For net-new sites,
use the target URL directly (`openweb login <site>` won't work).

**Auth-dependent capture requirements:**

| Auth type | Capture requirement |
|---|---|
| `exchange_chain` (Reddit-like) | Cold page load (clear cookies or incognito) so the token exchange request appears in HAR |
| `sapisidhash` (Google/YouTube) | Must be logged into Google account; SAPISID cookie + SAPISIDHASH header must appear |
| `cookie_session` with CSRF | Perform at least one mutation (like, follow) so CSRF token appears in POST headers |

#### Write Operations

Trigger writes after read flows. Prefer `page.evaluate(fetch(...))` (below)
over UI clicks. Find write endpoints from prior-round DOC.md or openapi.yaml.
After each write, trigger the reverse (like/unlike, follow/unfollow).

**Avoid:** logout, delete account, billing, irreversible actions.

### Direct API Calls via `page.evaluate(fetch)`

More reliable than hoping UI clicks trigger the right requests:

```javascript
await page.evaluate(() => fetch('/api/endpoint?q=value', {
  credentials: 'same-origin'
}))
```

**Prefer direct fetch for:** POST-based APIs (Innertube, GraphQL), known API
patterns without UI buttons, varied-parameter samples for schema inference.
**Same-origin only** — blocked by CORS cross-origin. Navigate to the target
subdomain first.

---

## Non-Cookie Auth Injection

`credentials: 'same-origin'` only carries cookies. For non-cookie auth
(`localStorage_jwt`, `page_global`, `webpack_module_walk`), extract and inject:

```javascript
// 1. Extract (method depends on auth type)
const token = await page.evaluate(() =>
  localStorage.getItem('auth_token')       // localStorage_jwt
  // OR: window.__AUTH_TOKEN__             // page_global
)

// 2. Inject into fetch
await page.evaluate((t) => fetch('/api/endpoint', {
  headers: { 'Authorization': `Bearer ${t}` },
}), token)
```

Check the site's `openapi.yaml` for extraction method and header.

---

## Capture Target Binding

Capture attaches to `pages()[0]` on start, auto-attaches to new tabs.

**Rules:** (1) Start capture FIRST, then open new tabs. (2) Pre-existing
tabs are blind spots. (3) A separate `connectOverCDP()` creates unmonitored
pages — use the existing connection's context.

**Verification:** Check `summary.byCategory.api` — if 0 despite browsing,
traffic came from a pre-existing tab or separate connection.

---

## Scripted Capture

For complex programmatic capture, use a two-phase approach:

1. `openweb capture start` (auto-starts browser) -> run script -> `openweb capture stop`
2. `openweb compile <site-url> --capture-dir ./capture`

This separates capture from compilation for fast iteration.

### Two-Phase Script Skeleton

```typescript
import { chromium } from 'patchright'

const browser = await chromium.connectOverCDP('http://localhost:9222')
const page = browser.contexts()[0]!.pages()[0]!  // reuse monitored page
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

await page.goto('https://example.com', { waitUntil: 'load', timeout: 30_000 })
await wait(3000)

await page.evaluate(() => fetch('/api/v1/feed?limit=20', {
  credentials: 'same-origin'
}))
await wait(800)

// Cleanup — bounded timeouts, always exit
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | void> =>
  Promise.race([p.catch(() => {}), new Promise<void>(r => setTimeout(r, ms))])
await withTimeout(browser.close(), 5_000)
process.exit(0)
```

**Key:** Reuse `pages()[0]` from the same connection — a second
`connectOverCDP()` creates unmonitored pages.

### `compile --script` Alternative

`openweb compile <url> --script ./record.ts` — manages its own capture
session via `createCaptureSession()`. Killed after 120s.

```typescript
import { parseArgs } from 'node:util'
import { chromium } from 'patchright'
import { createCaptureSession } from '../src/capture/session.js'

const { values } = parseArgs({ options: { out: { type: 'string' } }, strict: false })
const outputDir = values.out!

const browser = await chromium.connectOverCDP('http://localhost:9222')
const page = await browser.contexts()[0]!.newPage()

const session = createCaptureSession({
  cdpEndpoint: 'http://localhost:9222',
  outputDir, targetPage: page, isolateToTargetPage: true,
  onLog: (msg) => process.stderr.write(`${msg}\n`),
})
await session.ready

// ... navigate, call APIs ...
session.stop(); await session.done
await Promise.race([page.close().catch(()=>{}), new Promise<void>(r=>setTimeout(r,5000))])
process.exit(0)
```

See real adapters for examples (e.g., `src/sites/hackernews/adapters/`,
`src/sites/leetcode/adapters/`).

### Multi-Worker Browser Sharing

Multiple workers share one Chrome via `--isolate`, which scopes each session
to its own tab. Each worker runs `openweb capture start --isolate --url <url>`,
captures traffic, then `openweb capture stop --session $SESSION_ID`.

---

## Timeout Discipline

Every async operation needs a bounded timeout — CDP operations can block
indefinitely.

| Operation | Pattern | Why |
|---|---|---|
| `page.goto()` | `{ waitUntil: 'load', timeout: 30_000 }` | `'networkidle'` never fires on SPAs (persistent WS, polling). Use `'load'` + `await wait(3000)`. |
| `page.evaluate(fetch)` | `AbortController` with 15s timeout | Node.js timeouts don't reach into the browser |
| `page.close()` / `browser.close()` | `Promise.race` with 5s timeout | CDP session issues can hang |
| `session.done` | Safe as-is (3s drain timeout) | Already bounded |

**Fetch timeout pattern** (inside `page.evaluate`):

```typescript
await page.evaluate(async (args) => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const r = await fetch(args.url, {
      headers: args.headers, signal: ctrl.signal,
    })
    return { status: r.status, body: await r.text() }
  } finally { clearTimeout(timer) }
}, { url, headers })
```

Always end scripts with `process.exit(0)` — `setTimeout` in `withTimeout`
keeps the event loop alive.

---

## Capture Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| HAR has 0 API entries | Traffic from pre-existing tab | Start capture first, then open a NEW tab |
| `page.evaluate(fetch)` not in HAR | Separate Playwright connection | Use CDP on the capture's browser context |
| `No active capture session` on stop | Stale PID / process killed | `pkill -f "capture start"`, delete PID file, restart |
| HAR empty / truncated | Process killed before flush | Stop with `openweb capture stop`, never `kill -9` |
| `networkidle` hangs forever | SPA persistent connections | Use `waitUntil: 'load'` + fixed wait |
| Auth tokens missing from HAR | Didn't meet auth capture requirement | See auth-dependent capture table above |
| Cross-origin fetch blocked | CORS on `page.evaluate(fetch)` | Navigate to target subdomain first, use relative paths |
