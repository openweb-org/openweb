# WebSocket Patterns

Patterns for sites using WebSocket connections for real-time data. WS operations differ from REST: the connection is long-lived, messages are multiplexed, and interesting data is often a small fraction of total traffic.

## Message Types

### Heartbeat / Ping-Pong

Keepalive frames sent on an interval. Always present, never interesting.

- **Signal:** Periodic messages with no payload or fixed payload (`{"type":"ping"}`, `{"op":"heartbeat"}`)
- **Action:** Filter out during capture analysis -- these are not operations

### Subscribe / Unsubscribe

Client tells the server which channels to join. The server then pushes data on those channels.

- **Signal:** Message contains `subscribe`, `channel`, `topic`, or `stream` field
- **Example:** Discord: `{"op":14,"d":{"guild_id":"...","channels":{"...":[[0,99]]}}}`
- **Action:** Model as an operation when the subscription itself is the user intent

### Request-Reply

Client sends a request, server responds with a correlated message. Looks like REST over WebSocket.

- **Signal:** Messages have `id`/`request_id`/`nonce` field; response echoes it
- **Examples:**
  - Discord: `{"op":4,"d":{"guild_id":"...","query":"...","limit":10}}` -> server responds with matching `nonce`
  - Slack: `{"type":"message","channel":"C...","text":"hello","id":42}` -> `{"ok":true,"reply_to":42}`
- **Action:** Model as a standard operation with params->response. Map the correlation ID.

### Publish (Fire-and-Forget)

Client sends data without subscription; no server correlation. Detected when frames are sent-only without response or correlation ID.

- **Signal:** Sent-only frames with no matching reply and no correlation ID
- **Example:** Discord presence updates (`{"op":3,"d":{"status":"online",...}}`)
- **Action:** Model as a `publish` operation when the send itself is the user intent

### Stream / Push

Server pushes data continuously after connection or subscription. No client request triggers each message.

- **Signal:** Messages arrive without a preceding client message; often share a `channel` or `type` field
- **Example:** Discord: `{"t":"MESSAGE_CREATE","d":{"content":"hello","author":{...}}}`
- **Action:** Model as a stream operation. "Params" are the subscription; "response" is the message shape.

## Connection Patterns

### Authentication on Connect

Many WS APIs authenticate during the handshake or immediately after.

- **Cookie/header auth:** Auth token sent as a cookie or `Authorization` header on the HTTP upgrade request
- **First-message auth:** Client sends an `identify`/`auth` message immediately after connect
  - Discord: `{"op":2,"d":{"token":"...","properties":{...}}}`
  - Slack: sends connection token in the WebSocket URL itself

The runtime models four WS auth types (`src/types/ws-primitives.ts`):

| Type | When to use |
|------|-------------|
| `ws_first_message` | Client sends auth/identify frame after connect (Discord) |
| `ws_upgrade_header` | Token injected as HTTP header on the WS upgrade request |
| `ws_url_token` | Token embedded as a URL query/path param (Slack) |
| `ws_http_handshake` | Separate HTTP call exchanges credentials for a WS ticket before connect |

### Reconnection & Resume

Sites expect disconnects. Look for resume/reconnect protocols.

- Discord: gateway sends `session_id` + `seq`; client reconnects with `{"op":6,"d":{"session_id":"...","seq":123}}`
- Most sites: client simply reconnects and re-subscribes

### Multiplexed Connections

A single WS carries multiple logical channels.

- **Signal:** Messages have a `channel`, `type`, or `op` discriminator
- **Action:** Group messages by discriminator to identify distinct operations during capture

## Curation Signals

When analyzing captured WS traffic, use these signals to separate operations from noise:

| Signal | Likely Operation | Likely Noise |
|--------|-----------------|--------------|
| Client sends, server replies with correlated ID | Request-reply op | -- |
| Client sends subscribe, server pushes data | Stream op | -- |
| Fixed interval, no/empty payload | -- | Heartbeat |
| Same message shape repeated identically | -- | Keepalive or status |
| Message references a UI action (search, click) | Operation | -- |
| Binary frame (opcode 2) | -- | Usually internal protocol |

## Common False Positives

### Presence Updates

User status changes (`online`, `idle`, `typing`). High volume, rarely an operation.

- Discord: `{"op":3,"d":{"status":"online","activities":[...]}}` (client) and `{"t":"PRESENCE_UPDATE",...}` (server)
- **Action:** Filter out unless presence is the user intent

### Typing Indicators

`{"type":"typing","channel":"..."}` -- not an operation.

### Gateway Metadata

Session limits, rate limit headers, shard info. Useful for transport config, not operations.

- Discord: `{"op":10,"d":{"heartbeat_interval":41250}}` (hello)
- **Action:** Extract config values (heartbeat interval, session limits) but don't model as operations

## Transport Implications

- WS sites almost always require `page` or `adapter` transport -- the browser holds the WS connection
- Node transport can work if the WS handshake doesn't require browser-side tokens
- Capture must record WS frames (CDP `Network.webSocketFrameSent` / `Network.webSocketFrameReceived`)
- Long-running captures generate large volumes -- set a time bound or message count limit

## Site Package Modeling

WS operations *should* be modeled in `asyncapi.yaml` (separate from the HTTP `openapi.yaml`); not yet implemented in any bundled site (the spec format and runtime are ready; site-side coverage is pending):

```yaml
channels:
  ticker:
    address: wss://ws-feed.example.com
    messages:
      tickerUpdate:
        payload:
          type: object
          properties:
            product_id: { type: string }
            price: { type: string }

operations:
  subscribeTicker:
    action: send
    channel:
      $ref: '#/channels/ticker'
    x-openweb:
      permission: read
      pattern: subscribe
      subscribe_message:
        constants: { type: 'subscribe', channel: 'ticker' }
        bindings:
          - { path: 'product_id', source: 'param', key: 'product_id' }
      unsubscribe_message:
        constants: { type: 'unsubscribe', channel: 'ticker' }
        bindings: []
      correlation:
        field: 'request_id'
        source: 'uuid'
      event_match:
        type: 'ticker'
      build:
        source: 'capture'
```

The `x-openweb` extension on operations carries: `permission`, `pattern`, `subscribe_message`, `unsubscribe_message`, `correlation` (field + source: `echo`/`sequence`/`uuid`), `event_match` (server-frame matcher), and `build` metadata. See `src/types/ws-extensions.ts` for the full contract.
