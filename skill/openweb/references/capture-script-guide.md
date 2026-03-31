# Capture Script Guide

Timeout discipline and patterns for Playwright scripts used during capture.
Applies to both two-phase capture scripts and `compile --script` recordings.

## Why Scripts Hang

Capture scripts interact with a live browser via CDP. Any async operation can
block indefinitely: a page that never finishes loading, a fetch that stalls,
a CDP session that won't close. Without bounded timeouts, the script — and
the parent process waiting on it — hangs forever.

**Hard defense:** `compile --script` kills the child process after 120 seconds
(SIGTERM, then SIGKILL after 5s grace). But two-phase scripts (`capture start`
→ run script → `capture stop`) have no such guard — they run in your shell.
Either way, scripts should be self-bounding.

## Timeout Discipline

Every async operation needs a bounded timeout:

| Operation | Pattern | Why |
|-----------|---------|-----|
| `page.goto()` | `{ waitUntil: 'load', timeout: 30_000 }` | Never use `'networkidle'` — SPAs keep making requests indefinitely |
| `page.evaluate(fetch(...))` | `AbortController` with 15s timeout inside the evaluate | Network stalls or rate limits can block forever |
| `page.close()` / `browser.close()` | `Promise.race([p, sleep(5000)])` | CDP session issues can hang close |
| `session.done` | Already bounded (3s drain timeout internally) | Safe as-is |

### `networkidle` is never safe for SPAs

`waitUntil: 'networkidle'` waits until there are no more than 0-2 network
connections for 500ms. SPAs like Discord, Reddit, and YouTube maintain
persistent WebSocket connections and periodic XHR polling — networkidle
never fires. Use `'load'` and add a fixed `await wait(3000-5000)` after
for SPA hydration.

### Fetch timeout inside `page.evaluate`

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

### Bounded cleanup

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

## Two-Phase Capture Script Template

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

## `compile --script` Recording Template

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
