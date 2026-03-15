# Compiler Pipeline v2

> Evolved from v1 (see `archive/v1/architecture-pipeline.md`).
> Major changes: no built-in navigation agent, multi-source capture, pattern matching.

## Key v2 Change: Agent-Driven Browsing

v1 had a custom navigation agent (~200-300 lines) built into the compiler.
v2 removes this entirely. The user's agent (Claude Code, etc.) drives browsing
via Playwright CLI. OpenWeb's compiler only handles capture → analysis → generation.

```
v1:  openweb compile <url>  →  [built-in agent browses]  →  [analyze HAR]  →  spec
v2:  agent browses via playwright-cli  →  openweb capture (observes)  →  openweb compile  →  spec
```

## TODO

Carry forward v1 Phase 2-4 content and redesign Phase 1:

### Phase 1 redesign: Multi-Source Capture (No Built-In Navigation)

The agent browses. OpenWeb captures. Capture sources:

**HTTP traffic** — via Playwright CLI integration:
- `playwright-cli network` or Playwright `recordHar`
- Standard HAR format for HTTP request/response pairs

**Browser state** — via Playwright CLI commands:
- `playwright-cli localstorage-list` → all localStorage keys/values
- `playwright-cli sessionstorage-list` → sessionStorage
- `playwright-cli cookie-list` → cookies with attributes
- `playwright-cli eval <expr>` → window globals snapshot
- Snapshot at start + after each significant navigation

**WebSocket frames** — via CDP events or `playwright-cli run-code`:
- `Network.webSocketFrameReceived/Sent` events
- Capture: direction, payload, timestamp, connection URL
- See [browser-integration.md](browser-integration.md) for spec format discussion

**DOM state** — via `playwright-cli eval`:
- `<meta>` tags (CSRF tokens, config)
- `<script type="application/json">` tags (SSR data)
- Form hidden inputs
- Framework markers (`__NEXT_DATA__`, `__NUXT__`, `__APOLLO_STATE__`)

**Output**: Multi-source capture bundle (not just HAR):
```
capture/
├── traffic.har              # HTTP requests/responses
├── websocket_frames.jsonl   # WebSocket frame log (if any)
├── state_snapshots/         # Browser state at key points
│   ├── 001_initial.json     # { localStorage, sessionStorage, cookies, globals }
│   └── 002_after_login.json
├── dom_extractions.jsonl    # SSR data, meta tags found
└── metadata.json            # session info, timestamps, site URL
```

### Phase 2 changes: (mostly unchanged from v1)
- Clustering, parameter differentiation, schema induction, dependency graph
- NEW: Also cluster WebSocket messages by connection URL + payload pattern
- NEW: Include browser state keys in parameter differentiation
  (distinguish user-input vs session token vs CSRF in storage, not just HTTP)

### Phase 3 changes: Pattern Matching (NEW)
- After probing, match observed patterns against the pattern library
- Input: capture bundle (HTTP + WS + state + DOM) + probe results
- Output: Layer classification per endpoint (L1, L2, L3)
- For L2: emit primitive config with parameters
  (e.g., saw `localStorage['BSKY_STORAGE'] → Authorization header` → `auth.localStorage_jwt`)
- For L3: flag as needing code adapter

### Phase 4 changes: Emit Three Layers
- L1: Standard OpenAPI operations (unchanged from v1)
- L2: `x-openweb.primitives` section with pattern configs
- L3: Code adapter stubs in `adapters/` directory
- NEW: If WebSocket captured, emit AsyncAPI or x-openweb WS config (TBD)
