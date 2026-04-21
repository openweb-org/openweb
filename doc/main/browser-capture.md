# Browser Capture (CDP)

> Passive browser recording via Chrome DevTools Protocol.
> Last updated: 2026-03-31 (multi-worker isolation)

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
| HTTP traffic | `traffic.har` | All HTTP requests/responses (unfiltered, body-size-gated) |
| WebSocket frames | `websocket_frames.jsonl` (only written when WS frames are captured) | CDP `Network.webSocket*` events |
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

## Traffic Recording

HTTP traffic is recorded **without content-based filtering**. The capture module records every request/response pair — classification happens later in the Analyze phase (labeler).

| Rule | Behavior |
|------|----------|
| **All requests** | Recorded with full metadata (method, URL, headers, status, content-type) |
| **Body-size gate** | Response bodies > 1 MB are omitted; metadata still recorded |
| **No domain blocking** | Analytics, tracking, off-domain — all captured. Labeler classifies later. |
| **No content-type filtering** | HTML, CSS, images, JSON — all pass through. Labeler classifies later. |

This design ensures the compiler's Analyze phase has complete data for classification decisions, and no information is silently lost during capture.

-> See: `src/capture/har-capture.ts`, `src/compiler/analyzer/labeler.ts`

---

## Framework Globals Detection

DOM extraction detects 19 known framework globals:

`__NEXT_DATA__`, `__NUXT__`, `__APOLLO_STATE__`, `__PRELOADED_STATE__`, `ytcfg`, `WIZ_global_data`, etc.

These feed into the compiler's Phase 3 pattern matching (e.g., `__NEXT_DATA__` → `ssr_next_data` primitive).

-> See: `src/capture/dom-capture.ts`

---

## CDP Connection

```typescript
ensureBrowser(cdpEndpoint?: string): Promise<BrowserHandle>
```

Auto-manages browser instances. If no `cdpEndpoint` is provided, checks for a running managed browser and starts one if needed. Returns a `BrowserHandle` with `release()` for cleanup. Internally uses `connectWithRetry()` for CDP connection with linear backoff (1s per attempt, 3 attempts max).

-> See: `src/runtime/browser-lifecycle.ts`, `src/capture/connection.ts`

---

## Usage

```bash
# 1. Start capture (auto-starts managed browser if not running)
pnpm dev capture start

# 2. Browse to any site in the managed Chrome window (or use --cdp-endpoint for external)

# 3. Stop capture
pnpm dev capture stop
```

For an external Chrome instance:

```bash
# Start Chrome manually with remote debugging
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --no-first-run --user-data-dir=/tmp/openweb-chrome

pnpm dev capture start --cdp-endpoint http://localhost:9222
pnpm dev capture stop
```

### Isolated Capture (multi-worker)

Each worker gets its own page and session — no cross-contamination:

```bash
# Worker A
SESSION_A=$(openweb capture start --isolate --url https://discord.com)
openweb capture stop --session $SESSION_A
# Bundle at ./capture-$SESSION_A/

# Worker B (simultaneously)
SESSION_B=$(openweb capture start --isolate --url https://reddit.com)
openweb capture stop --session $SESSION_B
```

`--isolate` creates a new tab, navigates to `--url`, and passes `targetPage` +
`isolateToTargetPage: true` to `createCaptureSession`. Each session gets a unique
ID and session-scoped PID file (`.openweb-capture-<id>.pid`).

-> See: `src/commands/capture.ts`

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
├── har-capture.ts      # HTTP traffic capture with body-size-gate (no content filtering)
├── ws-capture.ts       # WebSocket frame capture via CDP Network events
├── state-capture.ts    # localStorage, sessionStorage, cookies snapshots
├── dom-capture.ts      # Meta tags, hidden inputs, framework globals detection
├── bundle.ts           # Write capture bundle directory to disk
├── connection.ts       # CDP connection with linear backoff (1s per attempt, 3 attempts max)
└── types.ts            # StateSnapshot, DomExtraction, WsFrame, CaptureMetadata, HAR types
```

---

## Related Docs

- [compiler.md](compiler.md) — Pipeline that consumes capture bundles
- [architecture.md](architecture.md) — System overview
- `src/capture/session.ts` — Capture orchestrator implementation
