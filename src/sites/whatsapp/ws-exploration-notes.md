# WhatsApp Web WebSocket Traffic Analysis

**Date:** 2026-03-25
**Duration:** 30 seconds passive capture
**Tool:** scripts/explore-whatsapp-ws.ts via CDP

## Summary

WhatsApp Web uses **100% binary WebSocket frames**. Zero text or JSON frames were observed.
This is consistent with the Signal Protocol (end-to-end encryption) — all message payloads
are encrypted binary before being sent over the wire.

## Connections

Two concurrent WebSocket connections observed:

| Connection | URL |
|---|---|
| 1 | `wss://web.whatsapp.com/ws/chat?ED=CAIIBQgS` |
| 2 | `wss://web.whatsapp.com:5222/ws/chat?ED=CAIIBQgS` |

Port 5222 is the standard XMPP port — WhatsApp's protocol is derived from XMPP,
wrapped in a custom binary envelope.

## Frame Statistics

| Metric | Value |
|---|---|
| Total frames | 288 |
| Binary frames | 288 (100%) |
| Text/JSON frames | 0 (0%) |
| Total bytes | 216,152 |
| Min frame size | 44 B |
| Median frame size | 84 B |
| Max frame size | 54,428 B |
| Mean frame size | 751 B |

## Frame Payload Pattern

All payloads appear to start with a short header (3-4 bytes that look like length/type markers)
followed by base64-encoded encrypted content. Example prefixes: `AAA`, `AAB`, `AAI`, `ABv`, `AC9`.

The first bytes likely encode:
- Byte 0: Flags/version
- Bytes 1-3: Payload length (big-endian)

This is consistent with WhatsApp's custom binary framing on top of the WebSocket layer.

## Pipeline Compatibility

The current OpenWeb WS compile pipeline (`ws-load.ts`) **skips binary frames** (opcode 2).
Since WhatsApp Web traffic is 100% binary, the pipeline would produce zero parsed frames.

### What Would Be Needed

To support WhatsApp Web WS traffic, the pipeline would need:

1. **Binary frame decoding** — Parse the WhatsApp binary envelope (length-prefixed protobuf or similar)
2. **Protobuf schema inference** — WhatsApp uses protobuf-like encoding internally; would need to reverse-engineer the message schema
3. **Encryption layer** — The actual message content is Signal Protocol encrypted; only the routing/metadata envelope could be decoded without keys

### Conclusion

WhatsApp Web WS traffic is **not compilable** by the current pipeline. The protocol is:
- Fully binary (no JSON)
- End-to-end encrypted (Signal Protocol)
- Custom binary framing (WhatsApp envelope over XMPP-derived protocol)

This is fundamentally different from JSON-based WS APIs (like Coinbase) that the pipeline targets.
The captured data confirms the hypothesis from the task description.
