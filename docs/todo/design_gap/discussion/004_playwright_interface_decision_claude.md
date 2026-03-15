# Playwright Interface Decision

## Context

Playwright offers four interfaces: SDK (Node.js), CLI (Skills), MCP (official), MCP (community).
OpenWeb needs to capture traffic, read browser state, and intercept WebSocket — all alongside
an agent that's already browsing.

## Analysis

### What OpenWeb needs from Playwright

1. **HAR recording** — `recordHar` or `network` interception
2. **CDP event subscription** — `Network.webSocketFrame*` for WebSocket capture
3. **Browser state reads** — localStorage, sessionStorage, cookies, window globals
4. **JS evaluation** — `page.evaluate()` for DOM extraction, framework data
5. **Coexistence** — attach to an existing browser session the agent is already using

### Interface comparison for OpenWeb's use case

| Need | SDK | CLI (Skills) | MCP (official) | MCP (community) |
|------|-----|-------------|----------------|-----------------|
| HAR recording | `recordHar` API | Not exposed | Not exposed | Not exposed |
| CDP events | `page.context().newCDPSession()` | Via `run-code` | Not exposed | Not exposed |
| Browser state | Full API | `localstorage-list`, `cookie-list` etc. | Via snapshots | Via Playwright API |
| JS evaluation | `page.evaluate()` | `eval` command | Limited | Via Playwright API |
| Attach to existing | `connectOverCDP()` | `cdpEndpoint` config | `CDP_ENDPOINT` env | Connection pooling |

### Key insight

MCP interfaces abstract away CDP — they expose accessibility trees and structured snapshots,
not raw network events. **OpenWeb needs raw CDP access** for WebSocket frame capture and HAR
recording. This rules out MCP as the primary interface.

### SDK vs CLI

The CLI is a thin wrapper over the SDK. For agent use (Claude Code), the CLI is preferable:
- Token-efficient (no large schema loading)
- Agent-native (designed for coding agents)
- `run-code` provides full SDK access as escape hatch

But OpenWeb's compiler itself (the `openweb capture` command) should use the **SDK directly**:
- It's a Node.js process, not an LLM agent
- Needs programmatic CDP session management
- Needs `recordHar` API
- Needs structured event handling for WebSocket frames

## Decision

**Two-layer approach:**

1. **Agent (Claude Code) uses Playwright CLI** for browsing — `goto`, `click`, `fill`, etc.
2. **OpenWeb compiler uses Playwright SDK** for capture — connects to the same browser via
   `connectOverCDP()`, sets up HAR recording, CDP listeners, state snapshots.

Both connect to the same Chrome instance via CDP endpoint. No conflict — Playwright supports
multiple connections to a single browser.

```
Chrome (--remote-debugging-port=9222)
  ├── Playwright CLI (agent drives browsing)
  └── OpenWeb compiler (SDK, captures traffic + state)
```

This matches the "OpenWeb does not own the browser" principle — the agent browses, OpenWeb observes.
