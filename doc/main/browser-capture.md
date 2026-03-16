# Browser Capture (CDP)

> Passive browser recording via Chrome DevTools Protocol.
> Last updated: 2026-03-16 (commit: `dd2b17e`)

## Overview

The capture module connects to an already-running Chrome instance via CDP (`connectOverCDP`) and passively records four data sources into a capture bundle. OpenWeb never navigates or modifies page state — it is a passive observer alongside the user's browsing session.

```
Chrome (--remote-debugging-port=9222)
  ├── User / Agent ────── drives browsing
  └── OpenWeb capture ─── passively records traffic + state
```

-> See: `src/capture/session.ts`

---

## Capture Sources

| Source | Output file | What it captures |
|--------|-------------|------------------|
| HTTP traffic | `traffic.har` | API requests/responses (analytics filtered out) |
| WebSocket frames | `websocket_frames.jsonl` | CDP `Network.webSocket*` events |
| State snapshots | `state_snapshots/*.json` | localStorage, sessionStorage, cookies |
| DOM extraction | `dom_extractions/*.json` | Meta tags, hidden inputs, framework globals, webpack chunks |

Snapshots and DOM extractions are taken at capture start and on each page navigation.

---

## Capture Bundle

```
capture/
├── traffic.har                 # Filtered HTTP traffic (HAR 1.2)
├── websocket_frames.jsonl      # WebSocket frame log (if any WS connections)
├── state_snapshots/
│   ├── 001_initial.json
│   └── 002_navigation.json
├── dom_extractions/
│   ├── 001_initial.json
│   └── 002_navigation.json
└── metadata.json               # Capture summary (counts, timestamps, version)
```

**Idempotent:** Reruns clean the output directory first (no stale artifacts).

---

## Traffic Filtering

HTTP traffic is filtered **during** capture (not post-hoc):

| Filter | Rule |
|--------|------|
| **Blocked domains** (~30) | google-analytics.com, sentry.io, facebook.net, mixpanel.com, etc. |
| **Rejected MIME types** | text/html, text/css, image/\*, font/\*, video/\*, application/javascript |
| **Captured MIME types** | application/json, \*+json variants, text/event-stream (SSE), application/x-www-form-urlencoded |
| **Unknown MIME types** | Captured (conservative — keep rather than drop) |
| **Excluded paths** | Static assets (.js, .css, .png, .svg, .woff2, etc.) |

-> See: `src/capture/har-capture.ts` — full filter list

---

## Framework Globals Detection

DOM extraction detects 20+ known framework globals:

`__NEXT_DATA__`, `__NUXT__`, `__APOLLO_STATE__`, `ytcfg`, `webpackChunk*`, `gapi.client`, etc.

These feed into the compiler's Phase 3 pattern matching (e.g., `__NEXT_DATA__` → `ssr_next_data` primitive).

-> See: `src/capture/dom-capture.ts`

---

## CDP Connection

```typescript
connectWithRetry(endpoint: string, options?: { maxRetries, delay }): Browser
```

Connects to Chrome via CDP with exponential backoff. Default: 3 retries with 1s base delay.

-> See: `src/capture/connection.ts`

---

## Usage

```bash
# 1. Start Chrome with remote debugging
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --no-first-run --user-data-dir=/tmp/openweb-chrome

# 2. Browse to any site in that Chrome window

# 3. Start capture (runs in foreground, Ctrl+C to stop)
pnpm dev capture start --cdp-endpoint http://localhost:9222

# 4. Stop from another terminal (alternative to Ctrl+C)
pnpm dev capture stop
```

### Verification

```bash
ls capture/
# Expected: traffic.har  state_snapshots/  dom_extractions/  metadata.json

# Verify HAR captured API requests:
cat capture/metadata.json   # requestCount > 0, snapshotCount > 0
```

---

## File Structure

```
src/capture/
├── session.ts          # Capture lifecycle orchestrator (start/stop, page navigation events)
├── har-capture.ts      # HTTP traffic capture with domain/content-type filtering
├── ws-capture.ts       # WebSocket frame capture via CDP Network events
├── state-capture.ts    # localStorage, sessionStorage, cookies snapshots
├── dom-capture.ts      # Meta tags, hidden inputs, framework globals detection
├── bundle.ts           # Write capture bundle directory to disk
├── connection.ts       # CDP connection with exponential backoff
└── types.ts            # StateSnapshot, DomExtraction, WsFrame, CaptureMetadata, HAR types
```

---

## Related Docs

- [compiler.md](compiler.md) — Pipeline that consumes capture bundles
- [architecture.md](architecture.md) — System overview
- `src/capture/session.ts` — Capture orchestrator implementation
