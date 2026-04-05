# Capture Techniques

How to capture site traffic for the compiler. Interactive browsing, direct API
calls, scripted capture, auth injection, and troubleshooting.

**Load when:** guide.md Step 2 (Capture), or when debugging capture scripts.

---

## Capture Modes

Both modes produce HAR traffic. Use them together — UI browsing discovers
endpoints you don't know about; direct calls fill known coverage gaps.

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

If the site requires login, authenticate in the managed browser. For net-new
sites, `openweb login <site>` won't work — use the target URL directly.
Existing Chrome profile logins may carry over.

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

Often more reliable than hoping UI clicks trigger the right requests:

```javascript
await page.evaluate(() => fetch('/api/endpoint?q=value', {
  credentials: 'same-origin'
}))
```

**When to prefer direct fetch:**
- POST-based APIs (Innertube, GraphQL) — clicks may not send the right body
- You know the API pattern but can't find the UI button
- You want multiple varied-parameter samples for schema inference

**Same-origin only.** Blocked by CORS for cross-origin URLs. Navigate to the
target subdomain first, then use relative paths.

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

Check the site's `openapi.yaml` auth config for extraction method and header.

---

## Capture Target Binding

Capture is **browser-wide** by default — attaches to `pages()[0]` on start,
auto-attaches to new tabs via `context.on('page')`.

**Rules:**
1. Start capture FIRST, then open new tabs — they auto-attach.
2. Pre-existing tabs (opened before capture) are blind spots.
3. `page.evaluate(fetch(...))` works on any monitored page.
4. A separate `chromium.connectOverCDP()` connection creates pages that
   capture does NOT monitor. Use the existing connection's context.

**Verification:** After capture, check `summary.byCategory.api`. If 0 despite
browsing, traffic came from a pre-existing tab or separate connection.

**Isolated capture** (`--isolate`): Scopes to a single new tab. Use for
multi-worker scenarios.

---

## Scripted Capture

For complex programmatic capture, use a two-phase approach:

1. `openweb capture start` (auto-starts browser) -> run script -> `openweb capture stop`
2. `openweb compile <site-url> --capture-dir ./capture`

This separates capture from compilation for fast iteration.

### Two-Phase Script Skeleton

```typescript
import { chromium } from 'playwright'

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

`openweb compile <url> --script ./record.ts` — script receives `--out <dir>`
and manages its own capture session via `createCaptureSession()`. Killed after
120s. See real adapters for examples:
- `src/sites/hackernews/adapters/hackernews.ts` — simple REST
- `src/sites/leetcode/adapters/leetcode-graphql.ts` — GraphQL
- `src/sites/redfin/adapters/redfin-dom.ts` — DOM extraction
- `src/sites/booking/adapters/booking-web.ts` — browser-fetch with bot detection

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
