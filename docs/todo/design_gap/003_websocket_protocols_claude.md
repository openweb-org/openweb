# Design Gap: WebSocket-Based Auth and Data Transport

## Severity: HIGH

## Problem

Real-time applications use WebSocket connections as their primary data transport.
Authentication tokens are exchanged during WebSocket handshakes or in early message
frames, and data flows bidirectionally through the persistent connection. HAR is
HTTP-centric and does not capture WebSocket frames.

## Affected Sites

- **Discord** — All real-time features (messages, presence, voice) use WebSocket
  gateway. Auth token sent in initial IDENTIFY payload.
- **ClickUp** — Session JWT captured from WebSocket auth frame
  (`{method: "auth", token: "..."}`) before Angular app initializes
- **WhatsApp Web** — Encrypted WebSocket protocol (Signal Protocol over WS)
- **Slack** — Real-time messaging via WebSocket RTM API
- **Teams** — Signaling and presence via WebSocket

## Why OpenWeb Can't Handle It

1. HAR records HTTP traffic only; WebSocket frames are opaque
2. WebSocket handshake may appear in HAR as HTTP 101 Upgrade, but frame content
   is not recorded
3. Auth tokens exchanged in WebSocket frames never appear in HTTP headers
4. Bidirectional message streams have state machine semantics that can't be
   captured as request/response pairs
5. WebSocket messages may be binary (protobuf, custom encoding), not JSON

## Potential Mitigations

- **CDP WebSocket interception**: Playwright/CDP can intercept WebSocket frames
  via `Network.webSocketFrameSent` and `Network.webSocketFrameReceived` events.
  Extend recording to capture these.
- **WebSocket-aware spec format**: Add WebSocket endpoint definitions to the
  OpenAPI spec (or use AsyncAPI for WebSocket protocols)
- **Hybrid execution**: For WebSocket-dependent sites, maintain a browser session
  and proxy WebSocket messages rather than replaying HTTP
- **Scope limitation**: Accept that real-time features (live chat, presence) are
  out of scope; focus on REST/GraphQL endpoints that co-exist alongside WebSocket
