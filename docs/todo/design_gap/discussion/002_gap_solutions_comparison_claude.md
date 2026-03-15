# Discussion: How OpenTabs and ApiTap Solve the 12 Design Gaps

## Comparison Matrix

| # | Gap | OpenTabs | ApiTap | OpenWeb |
|---|---|---|---|---|
| 001 | Pure SSR | `fetchText()` + DOMParser | `read` mode + framework detection | Dead end |
| 002 | Browser state | SDK: `getLocalStorage()`, `getPageGlobal()`, `getAuthCache()` | Types exist, unimplemented | Dead end |
| 003 | WebSocket | `WebSocket.prototype.send` patch | Not supported | Dead end |
| 004 | Dynamic signing | `crypto.subtle` SigV4; gapi auto-handles SAPISIDHASH | Tier classification but can't re-sign | Dead end |
| 005 | CSRF rotation | Fetch page → extract token → use immediately | Detect CSRF name/body, partial | Dead end |
| 006 | DOM/SSR cache | `getElementById()` reads `<script>` JSON | Detects markers, doesn't extract | Dead end |
| 007 | No HTTP API | `globalThis.require()` for internal modules | Not supported | Not supported |
| 008 | Multi-step auth | `waitUntil()` + `getAuthCache()` | OAuth refresh supported, partial | Not supported |
| 009 | Persisted hashes | Runtime regex from webpack bundles | Captures full query string, partial | Dead end |
| 010 | Google gapi | `getPageGlobal('gapi.client.request')` | Captures HTTP but can't replay | Can't replay |
| 011 | Navigation/DOM | `browser_navigate_tab` + `waitForSelector()` | Capture-only, stateless replay | Not supported |
| 012 | Cross-origin | `credentials: 'include'` + Bearer headers | Subdomain fallback only | Partial |

**Score: OpenTabs 12/12, ApiTap ~4/12 partial, OpenWeb ~0.5/12**

## Why OpenTabs Wins Everything

One architectural decision explains it all: **code executes inside the browser page**.

```
Running JS inside the page = natural access to everything:
  ✓ localStorage / sessionStorage / cookies
  ✓ window globals
  ✓ WebSocket prototype patching
  ✓ crypto.subtle (can sign requests)
  ✓ gapi.client (can call directly)
  ✓ require() (can call internal modules)
  ✓ document.querySelector (can parse DOM)
  ✓ Browser's CORS handling + session cookies
```

This is not "more features" — it's an **architectural dimension reduction**. When
you execute inside the page, all 12 gaps simply don't exist.

## Why ApiTap/OpenWeb Can't Catch Up Within Their Architecture

Both ApiTap and OpenWeb are HTTP-centric:
- **Capture**: Record HTTP traffic (HAR / CDP)
- **Replay**: Re-send HTTP requests

But modern web apps keep state in browser memory, not HTTP:
- Auth tokens in localStorage (not cookies)
- CSRF tokens in page globals (not headers)
- Signing logic in webpack bundles (not observable from outside)
- Some apps have NO HTTP API at all (WhatsApp, Telegram)

**The gap is not feature-level — it's architecture-level.**

## Implications for OpenWeb

Three paths forward:
1. **Accept limitation** — like ApiTap, classify sites by replayability tier
2. **Hybrid model** — HAR compile + browser fallback for complex sites
3. **Converge to OpenTabs** — abandon spec-first, become browser-first

Or: find a way to get the best of both worlds (see next discussion).
