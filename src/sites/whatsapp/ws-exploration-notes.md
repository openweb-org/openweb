# WhatsApp Web WebSocket Traffic Analysis

**Date:** 2026-03-25
**Tools:** scripts/explore-whatsapp-ws.ts, scripts/whatsapp-store-extract.ts, scripts/whatsapp-final-send.ts

## TL;DR

WhatsApp Web WS frames are 100% encrypted binary (Signal Protocol). However, the browser
**must decrypt messages client-side** to display them. We found that WhatsApp Web uses a
Metro-style module system with `require('WAWeb*')` string IDs, exposing internal stores
(`ChatCollection`, `MsgCollection`, `Contact`, etc.) with **fully decrypted plaintext**.

We successfully:
1. Accessed 42 chats and 2,253 contacts via internal stores
2. Read decrypted message bodies from the in-memory `MsgCollection`
3. Sent 3 test messages to the safe contact via the compose box + Enter key
4. Verified delivery (ack=1) by reading back from the Store

## Part 1: Wire-Level Analysis (WS Frames)

### Connections

Two concurrent WebSocket connections:

| Connection | URL |
|---|---|
| 1 | `wss://web.whatsapp.com/ws/chat?ED=CAIIBQgS` |
| 2 | `wss://web.whatsapp.com:5222/ws/chat?ED=CAIIBQgS` |

Port 5222 = standard XMPP port (WhatsApp's protocol is XMPP-derived).

### Frame Statistics (30s passive capture)

| Metric | Value |
|---|---|
| Total frames | 288 |
| Binary frames | 288 (100%) |
| Text/JSON frames | 0 (0%) |
| Total bytes | 216,152 |
| Min / Median / Max frame | 44B / 84B / 54,428B |

### During Message Send (3 messages)

| Metric | Value |
|---|---|
| Total frames | 30 |
| Sent | 17 |
| Received | 13 |
| All binary | yes |
| Frame sizes | 52B – 1,916B (avg 320B) |

### Pipeline Compatibility

The WS compile pipeline (`ws-load.ts`) skips binary frames (opcode 2).
WhatsApp traffic is 100% binary → pipeline produces zero parsed frames.
**Wire-level capture is not viable** for this site.

## Part 2: Application-Level Access (Breakthrough)

### Module System

WhatsApp Web uses a **Metro-style bundler** (not webpack) with:
- `__d(factory, moduleId, deps)` — defines modules
- `require(moduleId)` — loads by string ID (e.g., `'WAWebMsgCollection'`)

The `webpackChunkwhatsapp_web_client` array exists but its `push` is `[native code]` —
the classic webpack chunk injection technique does **not** work here.
The Metro `require()` with string module IDs works directly.

### Key Modules Discovered

| Module | Exports |
|---|---|
| `WAWebChatCollection` | `ChatCollection` — all chats with metadata |
| `WAWebMsgCollection` | `MsgCollection` — messages per chat |
| `WAWebContactCollection` | `ContactCollection` — all contacts |
| `WAWebCollections` | Master store: Chat, Msg, Contact, Presence, Label, etc. |
| `WAWebMsgModel` | `Msg` — message model class |
| `WAWebChatModel` | `Chat` — chat model class |
| `WAWebConnModel` | `Conn` — connection info |
| `WAWebSocketModel` | `Socket` — WS socket access |
| `WAWebCmd` | `Cmd` — UI commands (openChat, sendStar, etc.) |
| `WAWebWidFactory` | `createWid` — create WhatsApp IDs |
| `WAWebSendMsgChatAction` | `addAndSendMsgToChat` — send messages |
| `WAWebSendMsgRecordAction` | `sendMsgRecord` — low-level send |
| `WAWebBuildConstants` | Version: `2.3000.1035920916` |

### Data Access: Decrypted Messages

```javascript
// In page context (via page.evaluate):
const { ChatCollection } = require('WAWebChatCollection')
const chats = ChatCollection.getModelsArray()  // 42 chats

const chat = chats.find(c => c.id._serialized === '13472225726@c.us')
const msgs = chat.msgs.getModelsArray()

// Each message has:
// msg.body     — decrypted plaintext (e.g., "openweb test 1")
// msg.type     — "chat", "image", "video", etc.
// msg.t        — Unix timestamp
// msg.ack      — delivery status (0=pending, 1=server, 2=delivered, 3=read)
// msg.id.fromMe — boolean
```

### IndexedDB

`model-storage` database (version 1910) has 100 object stores including:
- `message` (70 records) — but body field is **empty** in IDB
- `chat` (42 records) — metadata only
- `contact` — IDs and phone numbers
- `signal-storage` — Signal Protocol keys

Messages are decrypted **in memory only**, not persisted to IndexedDB with plaintext body.

### No REST Traffic

Zero HTTP/REST API calls observed in 10 seconds of monitoring.
All communication goes through the encrypted WebSocket.

## Part 3: Strategy for OpenWeb Integration

### Viable Approach: Store-Level Capture

Instead of capturing WS frames, capture at the **application store level**:

1. Connect to browser via CDP
2. Use `page.evaluate()` to access `require('WAWebChatCollection')`
3. Read decrypted messages from `chat.msgs.getModelsArray()`
4. Send messages via compose box (type + Enter) or `addAndSendMsgToChat()`
5. Poll for new messages by watching the collection

### What This Means for the Pipeline

The current WS capture → compile pipeline is designed for JSON WS APIs.
WhatsApp requires a fundamentally different capture strategy:

| Aspect | Current Pipeline | WhatsApp Needs |
|---|---|---|
| Capture layer | CDP Network events | `page.evaluate()` into Store |
| Data format | JSON WS frames | JS objects from internal models |
| Schema source | Frame clustering | Model class inspection |
| Send/receive | WS frame direction | `msg.id.fromMe` boolean |

A new **Store-level capture adapter** would bridge WhatsApp's internal API
to the existing compile pipeline by converting Store data to the JSONL format
that `ws-load.ts` expects.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/explore-whatsapp-ws.ts` | WS frame capture (binary analysis) |
| `scripts/probe-whatsapp-internals.ts` | CDP probing (globals, IDB, HTTP) |
| `scripts/probe-whatsapp-deep.ts` | IDB messages, Metro require |
| `scripts/probe-whatsapp-stores.ts` | Text messages, require/\_\_d analysis |
| `scripts/probe-whatsapp-extract.ts` | Module name discovery, webpack injection |
| `scripts/whatsapp-store-extract.ts` | Store data extraction (chats, msgs) |
| `scripts/whatsapp-navigate-chat.ts` | Open target chat via deep link |
| `scripts/whatsapp-final-send.ts` | Send + capture + verify end-to-end |
