# WhatsApp Web — Technical Documentation

## Transport

WhatsApp Web uses **encrypted binary WebSocket** (Signal Protocol). All WS frames are opcode 2 (binary), zero JSON. Two concurrent connections:

- `wss://web.whatsapp.com/ws/chat` (port 443)
- `wss://web.whatsapp.com:5222/ws/chat` (port 5222, XMPP-derived)

No REST/HTTP API calls — all communication goes through the encrypted WS.

## Application-Level Access

WhatsApp Web uses a **Metro-style module system** (not webpack). Modules are accessible via `require('WAWeb*')` string IDs from `page.evaluate()`.

### Key Modules

| Module | Exports |
|---|---|
| `WAWebChatCollection` | `ChatCollection` — all chats with metadata |
| `WAWebMsgCollection` | `MsgCollection` — messages per chat |
| `WAWebContactCollection` | `ContactCollection` — all contacts |
| `WAWebCollections` | Master store: Chat, Msg, Contact, Presence, Label, etc. |
| `WAWebSendMsgChatAction` | `addAndSendMsgToChat` — send messages |
| `WAWebCmd` | UI commands (openChat, sendStar, etc.) |
| `WAWebWidFactory` | `createWid` — create WhatsApp IDs |

### Reading Messages

```javascript
// In page context (via page.evaluate):
const { ChatCollection } = require('WAWebChatCollection')
const chat = ChatCollection.getModelsArray()
  .find(c => c.id._serialized === '1234567890@c.us')
const msgs = chat.msgs.getModelsArray()

// msg.body     — decrypted plaintext
// msg.type     — "chat", "image", "video", etc.
// msg.t        — Unix timestamp
// msg.ack      — 0=pending, 1=server, 2=delivered, 3=read
// msg.id.fromMe — boolean
```

### Sending Messages

Compose box + Enter key (DOM interaction), or `addAndSendMsgToChat()` via Store.

### IndexedDB

`model-storage` database (version 1910), 100 object stores. Message body field is **empty** in IDB — messages are decrypted in memory only.

## Pipeline Implications

| Aspect | Current WS Pipeline | WhatsApp Needs |
|---|---|---|
| Capture layer | CDP Network events | `page.evaluate()` into Store |
| Data format | JSON WS frames | JS objects from internal models |
| Schema source | Frame clustering | Model class inspection |
| Send/receive | WS frame direction | `msg.id.fromMe` boolean |

A **Store-level capture adapter** is needed to bridge WhatsApp's internal API to the JSONL format `ws-load.ts` expects.

## Auth

QR code scan via headed browser. Session persists in browser profile.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/explore-whatsapp-ws.ts` | WS binary frame analysis |
| `scripts/whatsapp-store-extract.ts` | Store data extraction (chats, msgs) |
| `scripts/whatsapp-final-send.ts` | Send + capture + verify end-to-end |
