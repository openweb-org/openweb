# Browser Integration & Capture Architecture

> **NEW in v2.** Defines how OpenWeb coexists with Playwright CLI and how data
> is captured beyond HAR.

## Core Principle: OpenWeb Does Not Own the Browser

The user's agent (Claude Code, Cursor, etc.) drives the browser via Playwright CLI.
OpenWeb adds compilation and tool execution on top. Clear scope separation:

```
Playwright CLI scope:           OpenWeb scope:
├── Navigate (goto, click)      ├── Capture traffic + state
├── Screenshots / a11y tree     ├── Analyze & pattern-match
├── Storage access              ├── Generate spec (L1 + L2 + L3)
├── JS execution (eval)         ├── Execute compiled tools
├── Tracing                     └── Self-healing
└── Session management
```

## TODO

### No Built-In Navigation Agent

v1 proposed a custom navigation agent (~200-300 lines, Playwright + LLM). v2 removes
this entirely. The user's agent IS the browser-use agent:

- Agent browses via `playwright-cli goto/click/fill/...`
- OpenWeb observes the same browser session
- One CDP connection, zero conflict
- Agent understands user intent (no context lost to inner agent)

**Two-layer Playwright approach**:
1. **Agent uses Playwright CLI** for browsing (goto, click, fill, etc.)
2. **OpenWeb compiler uses Playwright SDK** for capture (connects via `connectOverCDP()`)

Both connect to the same Chrome instance. No conflict — Playwright supports multiple CDP connections.

```
Chrome (--remote-debugging-port=9222)
  ├── Playwright CLI (agent drives browsing)
  └── OpenWeb compiler SDK (captures traffic + state)
```

`openweb capture start --cdp-endpoint http://localhost:9222` attaches to the agent's browser session.

See `docs/todo/design_gap/discussion/004_playwright_interface_decision_claude.md` for full analysis.

### Multi-Source Capture (Beyond HAR)

HAR only captures HTTP. Modern SPAs store state everywhere. Define capture sources:

**HTTP traffic** — via Playwright's `network` command or `recordHar`:
- Request/response pairs, headers, bodies
- Standard HAR format for compatibility

**WebSocket frames** — via CDP `Network.webSocketFrame*` events:
- Requires `playwright-cli run-code` to set up CDP listener
- Or openweb connects to same CDP endpoint independently
- Capture: frame direction, payload, timestamp
- **Open question**: How to integrate into the spec? (see below)

**Browser storage** — via Playwright CLI commands:
- `playwright-cli localstorage-list` → all keys/values
- `playwright-cli sessionstorage-list` → all keys/values
- `playwright-cli cookie-list` → all cookies with attributes
- Snapshot before/after each navigation

**Window globals** — via `playwright-cli eval`:
- Configurable list of globals to capture: `__NEXT_DATA__`, `__NUXT__`, etc.
- Or auto-detect: eval a discovery script that finds common patterns

**DOM state** — via `playwright-cli eval` or snapshots:
- `<meta>` tags (CSRF tokens, config)
- `<script type="application/json">` tags (SSR data)
- Form hidden inputs

### Non-HTTP Protocol Spec Format — DECIDED: AsyncAPI 3.x

WebSocket and SSE can't be described in OpenAPI 3.1.

**Decision**: AsyncAPI 3.x for WebSocket/SSE API description.
- Complements OpenAPI (shared JSON Schema vocabulary)
- Describes message schemas per channel, publish/subscribe operations
- Discord, ClickUp, Slack all have meaningful WebSocket APIs worth structuring
- WhatsApp/Telegram are L3 regardless — their WebSocket complexity is beyond any spec

**Capture format**: Custom JSONL (`websocket_frames.jsonl`) for frame-level recording.
CDP `Network.webSocketFrame*` events → JSONL with connectionId, timestamp, direction, opcode, payload.

**Package layout**:
```
site-skill/
├── openapi.yaml      # L1: REST endpoints
├── asyncapi.yaml     # L1: WebSocket/SSE channels (if any)
├── patterns.yaml     # L2: interaction primitives
└── adapters/         # L3: code escape hatches
```

See `docs/todo/design_gap/discussion/005_websocket_spec_format_claude.md` for full analysis.

### Playwright CLI Reference

Key commands openweb would use or compose with:
- `playwright-cli network` — list HTTP requests (alternative to HAR)
- `playwright-cli localstorage-list/get` — read localStorage
- `playwright-cli sessionstorage-list/get` — read sessionStorage
- `playwright-cli cookie-list` — read cookies
- `playwright-cli eval <expr>` — evaluate JS in page
- `playwright-cli run-code <code>` — run complex Playwright code
- `playwright-cli tracing-start/stop` — comprehensive recording
- `playwright-cli state-save/load` — export/import browser state

See `.reference/browser-infra/playwright-cli/` for full CLI documentation.
