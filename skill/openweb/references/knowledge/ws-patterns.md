# WebSocket Patterns

Patterns for sites that use WebSocket connections for real-time data. WebSocket operations differ from REST: the connection is long-lived, messages are multiplexed, and the interesting data is often a small fraction of total traffic.

## Message Types

### Heartbeat / Ping-Pong

Keepalive frames sent on an interval. Always present, never interesting.

- **Signal:** periodic messages with no payload or fixed payload (`{"type":"ping"}`, `{"op":"heartbeat"}`)
- **Action:** filter out during capture analysis — these are not operations

### Subscribe / Unsubscribe

Client tells the server which channels to join. The server then pushes data on those channels.

- **Signal:** message contains `subscribe`, `channel`, `topic`, or `stream` field
- **Examples:**
  - Discord: `{"op":14,"d":{"guild_id":"...","channels":{"...":[[0,99]]}}}`
  - Coinbase: `{"type":"subscribe","channels":[{"name":"ticker","product_ids":["BTC-USD"]}]}`
- **Action:** model as an operation when the subscription itself is the user intent (e.g., "watch BTC price")

### Request-Reply

Client sends a request, server responds with a correlated message. Looks like REST over WebSocket.

- **Signal:** messages have `id`/`request_id`/`nonce` field; response echoes it
- **Examples:**
  - Discord: `{"op":4,"d":{"guild_id":"...","query":"...","limit":10}}` → server responds with matching `nonce`
  - Slack: `{"type":"message","channel":"C...","text":"hello","id":42}` → `{"ok":true,"reply_to":42}`
- **Action:** model as a standard operation with params→response. Map the correlation ID.

### Stream / Push

Server pushes data continuously after connection or subscription. No client request triggers each message.

- **Signal:** messages arrive without a preceding client message; often share a `channel` or `type` field
- **Examples:**
  - Coinbase: `{"type":"ticker","product_id":"BTC-USD","price":"43210.00",...}`
  - Discord: `{"t":"MESSAGE_CREATE","d":{"content":"hello","author":{...}}}`
- **Action:** model as a stream operation. The "params" are the subscription; the "response" is the message shape.

## Connection Patterns

### Authentication on Connect

Many WS APIs authenticate during the handshake or immediately after.

- **Cookie/header auth:** auth token sent as a cookie or `Authorization` header on the HTTP upgrade request
- **First-message auth:** client sends an `identify`/`auth` message immediately after connect
  - Discord: `{"op":2,"d":{"token":"...","properties":{...}}}`
  - Slack: sends connection token in the WebSocket URL itself

### Reconnection & Resume

Sites expect disconnects. Look for resume/reconnect protocols.

- Discord: gateway sends `session_id` + `seq`; client reconnects with `{"op":6,"d":{"session_id":"...","seq":123}}`
- Most sites: client simply reconnects and re-subscribes

### Multiplexed Connections

A single WS carries multiple logical channels.

- **Signal:** messages have a `channel`, `type`, or `op` discriminator
- **Action:** during capture, group messages by discriminator to identify distinct operations

## Curation Signals

When analyzing captured WS traffic, use these signals to separate operations from noise:

| Signal | Likely operation | Likely noise |
|--------|-----------------|--------------|
| Client sends, server replies with correlated ID | Request-reply op | — |
| Client sends subscribe, server pushes data | Stream op | — |
| Fixed interval, no/empty payload | — | Heartbeat |
| Same message shape repeated identically | — | Keepalive or status |
| Message references a UI action (search, click) | Operation | — |
| Binary frame (opcode 2) | — | Usually internal protocol |

## Common False Positives

### Presence Updates

User status changes (`online`, `idle`, `typing`). High volume, rarely an operation.

- Discord: `{"op":3,"d":{"status":"online","activities":[...]}}` (client) and `{"t":"PRESENCE_UPDATE",...}` (server)
- **Action:** filter out unless presence is the user intent

### Typing Indicators

`{"type":"typing","channel":"..."}` — not an operation.

### Gateway Metadata

Session limits, rate limit headers, shard info. Useful for transport config, not operations.

- Discord: `{"op":10,"d":{"heartbeat_interval":41250}}` (hello)
- **Action:** extract config values (heartbeat interval, session limits) but don't model as operations

## Transport Implications

- WS sites almost always require `page` or `adapter` transport — the browser holds the WS connection
- Node transport can work if the WS handshake doesn't require browser-side tokens
- Capture must record WS frames (CDP `Network.webSocketFrameSent` / `Network.webSocketFrameReceived`)
- Long-running captures generate large volumes — set a time bound or message count limit

## Site Package Modeling

WS operations are modeled in `asyncapi.yaml` (separate from the HTTP `openapi.yaml`).

```yaml
# asyncapi.yaml
channels:
  ticker:
    address: wss://ws-feed.example.com
    messages:
      tickerUpdate:
        payload:
          type: object
          properties:
            product_id:
              type: string
            price:
              type: string

operations:
  subscribeTicker:
    action: send
    channel:
      $ref: '#/channels/ticker'
    x-openweb:
      permission: read
      pattern: subscribe
```

The `x-openweb` extension on operations specifies permission and message pattern.

## Related References

- `references/analysis-review.md` — WebSocket analysis during Review
- `references/compile.md` — WS verification in Step 4
- `references/discover.md` — WS traffic inspection during capture
- `references/knowledge/troubleshooting-patterns.md` — WS failure patterns
