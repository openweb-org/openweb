# Browser Capture

> **Last updated**: 2026-03-15 (commit `ca1ba52`)

## Overview

The capture module connects to an already-running Chrome instance via CDP
(`connectOverCDP`) and passively records four data sources into a capture
bundle. OpenWeb never navigates or modifies page state — it is a passive
observer alongside the agent's Playwright CLI session.

```
Chrome (--remote-debugging-port=9222)
  ├── Agent (Playwright CLI) ──── drives browsing
  └── OpenWeb capture ─────────── passively records traffic + state
```

-> See: [doc/todo/v2/browser-integration.md](../todo/v2/browser-integration.md) — full design spec

## Capture Sources

| Source | Output file | What it captures |
|--------|-------------|------------------|
| HTTP traffic | `traffic.har` | API requests/responses (analytics/tracking filtered out) |
| WebSocket frames | `websocket_frames.jsonl` | CDP `Network.webSocket*` events |
| State snapshots | `state_snapshots/*.json` | localStorage, sessionStorage, cookies |
| DOM extraction | `dom_extractions/*.json` | Meta tags, hidden inputs, framework globals, webpack chunks |

Snapshots and DOM extractions are taken at capture start and on each page navigation.

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

## Traffic Filtering

HTTP traffic is filtered **during** capture (not post-hoc):

- **Blocked domains** (~30): google-analytics.com, sentry.io, facebook.net, mixpanel.com, etc.
- **Rejected MIME types**: text/html, text/css, image/*, font/*, video/*, application/javascript
- **Captured MIME types**: application/json, `*+json` variants, text/event-stream (SSE), application/x-www-form-urlencoded
- **Unknown MIME types**: captured (conservative — keep rather than drop)
- **Excluded paths**: static assets (`.js`, `.css`, `.png`, `.svg`, `.woff2`, etc.)
- **Bundle is idempotent**: reruns clean the output dir first (no stale artifacts)

-> See: `src/capture/har-capture.ts` — full filter list

## Module Structure

```
src/capture/
├── types.ts          # StateSnapshot, DomExtraction, WsFrame, CaptureMetadata, HAR types
├── connection.ts     # connectWithRetry() — CDP connection with exponential backoff
├── har-capture.ts    # HTTP traffic capture with domain/content-type filtering
├── ws-capture.ts     # WebSocket frame capture via CDP Network events
├── state-capture.ts  # localStorage, sessionStorage, cookies snapshots
├── dom-capture.ts    # Meta tags, hidden inputs, framework globals detection
├── bundle.ts         # Write capture bundle directory to disk
└── session.ts        # Orchestrates all sources, manages capture lifecycle
```

## Framework Globals Detection

DOM extraction detects 20+ known framework globals:

`__NEXT_DATA__`, `__NUXT__`, `__APOLLO_STATE__`, `ytcfg`, `webpackChunk*`, `gapi.client`, etc.

These feed into the compiler's Phase 3 pattern matching (e.g., `__NEXT_DATA__` → `ssr_next_data` primitive).
