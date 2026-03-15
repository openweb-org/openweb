# WebSocket/SSE Spec Format Decision

## Context

OpenAPI 3.1 cannot describe WebSocket or SSE APIs. We need a spec format for non-HTTP protocols.
Three options were proposed in browser-integration.md.

## Research Findings

### AsyncAPI 3.x
- Industry standard for event-driven APIs (WebSocket, MQTT, SSE, Kafka, etc.)
- Complements OpenAPI — shares JSON Schema vocabulary
- WebSocket binding (v0.1.0): models HTTP handshake but NOT individual frame types or sequencing
- SSE: no first-class binding, modeled as unidirectional HTTP channel
- Tooling: code generators, validators, documentation generators exist
- Con: thin WebSocket binding, adds a second spec format

### x-openweb extensions in OpenAPI
- Keep everything in one file
- No tooling support, non-standard
- Breaks OpenAPI validators

### Layer 3 only (code adapters for all WebSocket)
- Simplest approach
- Loses all structure for WebSocket-based features
- Makes WebSocket sites permanently L3

## Analysis: How many sites need WebSocket?

From the 12 design gaps and OpenTabs plugins:
- **Discord**: Heavy WebSocket (Gateway API) — messages, presence, voice state
- **ClickUp**: WebSocket for real-time updates
- **Slack**: WebSocket for real-time messaging
- **WhatsApp**: Internal WebSocket (already L3 for other reasons)
- **Telegram**: Internal WebSocket (already L3 for other reasons)

WhatsApp/Telegram are L3 regardless. That leaves Discord, ClickUp, Slack as sites where
WebSocket spec structure would add value. This is a meaningful number — these are major platforms.

## Decision: AsyncAPI for L1, JSONL for capture

### For API description (Layer 1 structural spec):
**AsyncAPI 3.x** — despite thin WebSocket binding, it's the only standard that:
- Describes message schemas per channel
- Defines publish/subscribe operations
- Complements OpenAPI (same JSON Schema)
- Has real tooling

For SSE, model as unidirectional channel with HTTP binding + `receive` operations.

### For traffic capture (compiler input):
**Custom JSONL** (`websocket_frames.jsonl`) — already in compiler-pipeline.md:

```jsonl
{"connectionId":"ws1","timestamp":"2026-03-15T10:00:00Z","type":"open","metadata":{"url":"wss://gateway.discord.gg","headers":{}}}
{"connectionId":"ws1","timestamp":"2026-03-15T10:00:01Z","type":"frame","direction":"sent","opcode":1,"payload":"{\"op\":2,\"d\":{\"token\":\"...\"}}"}
{"connectionId":"ws1","timestamp":"2026-03-15T10:00:02Z","type":"frame","direction":"received","opcode":1,"payload":"{\"op\":0,\"d\":{\"guilds\":[...]}}"}
{"connectionId":"ws1","timestamp":"2026-03-15T10:05:00Z","type":"close","metadata":{"code":1000,"reason":"normal"}}
```

### For SSE capture:
Same JSONL format, extended:
```jsonl
{"connectionId":"sse1","timestamp":"...","type":"event","sseEventType":"message","sseId":"42","payload":"...","metadata":{"url":"https://..."}}
```

## Package structure

```
site-skill/
├── openapi.yaml           # L1: REST endpoints
├── asyncapi.yaml          # L1: WebSocket/SSE channels (if any)
├── patterns.yaml          # L2: interaction primitives
├── adapters/              # L3: code escape hatches
└── capture/               # compiler input (not shipped)
    ├── traffic.har
    └── websocket_frames.jsonl
```

## Naming

Resolve D3 in README as: **"AsyncAPI 3.x for WebSocket/SSE description, JSONL for capture."**
