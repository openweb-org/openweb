# WhatsApp Web

## Overview
Messaging platform — L3 adapter accessing Meta's internal module system via `require('WAWeb*')`.

## Workflows

### List and read conversations
1. `getChats` → pick chat → `chatId`
2. `getMessages(chatId)` → messages with body, timestamp, type

### Find a specific chat
1. `searchChats(query)` → matching chats → `chatId`
2. `getChatById(chatId)` → detailed info (archived, pinned, muted, lastMessage)

### Send a message
1. `getChats` or `searchChats(query)` → `chatId`
2. `sendMessage(chatId, message)` → success + timestamp

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getChats | list conversations | limit | id, name, isGroup, unreadCount | entry point |
| getMessages | read messages | chatId ← getChats | id, body, fromMe, timestamp, type | most recent N messages |
| getContacts | list contacts | limit | id, name, isMe | entry point |
| searchChats | find chats by name | query | id, name, isGroup | client-side filter |
| getChatById | chat detail | chatId ← getChats | archived, pinned, muted, lastMessage | |
| sendMessage | send text | chatId ← getChats, message | success, timestamp | write — uses DOM keyboard input |
| markAsRead | mark read/unread | chatId ← getChats, read | success | write |

## Quick Start

```bash
# List recent chats
openweb whatsapp exec getChats '{"limit": 10}'

# Read messages from a chat
openweb whatsapp exec getMessages '{"chatId": "1234567890@c.us", "limit": 20}'

# Search for a chat
openweb whatsapp exec searchChats '{"query": "John"}'

# Get chat details
openweb whatsapp exec getChatById '{"chatId": "1234567890@c.us"}'

# List contacts
openweb whatsapp exec getContacts '{"limit": 50}'
```

---

## Site Internals

## API Architecture
No REST/GraphQL API. WhatsApp Web uses encrypted binary WebSocket (Signal Protocol) for all communication. Two concurrent WS connections:
- `wss://web.whatsapp.com/ws/chat` (port 443)
- `wss://web.whatsapp.com:5222/ws/chat` (XMPP-derived)

All data access goes through Meta's Metro-style module system (`require('WAWeb*')`), not HTTP.

### Key Modules

| Module | Exports |
|--------|---------|
| `WAWebChatCollection` | `ChatCollection` — all chats with metadata |
| `WAWebContactCollection` | `ContactCollection` — all contacts |
| `WAWebCollections` | Master store: Chat, Msg, Contact, Presence, Label |
| `WAWebCmd` | UI commands (openChat, sendStar) |
| `WAWebChatSeenBridge` | Mark read/unread |

## Auth
QR code scan in headed browser. Session persists in browser profile. No standard auth primitive — adapter checks `ChatCollection.length > 0` to verify auth.

## Transport
`page` transport only. All operations execute via `page.evaluate()` against internal modules. Node transport is impossible — no HTTP API exists.

## Known Issues
- **QR scan required**: User must scan QR code in managed browser before operations work.
- **Binary WS**: Standard capture produces 0 usable API samples — adapter-only site.
- **sendMessage uses DOM input**: Store-level `addAndSendMsgToChat` silently drops messages in adapter context. Compose box keyboard input is the reliable approach.
- **Messages decrypted in memory only**: IndexedDB stores empty message bodies — messages only exist decrypted in the in-memory Store.
- **Module names may change**: Meta can rename `WAWeb*` module IDs in updates.
