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

### Delete a message
1. `getChats` or `searchChats(query)` → `chatId`
2. `getMessages(chatId)` → pick message → `messageId`
3. `deleteMessage(chatId, messageId)` → success

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getChats | list conversations | limit | id, name, isGroup, unreadCount | entry point |
| getMessages | read messages | chatId ← getChats | id, body, fromMe, timestamp, type | most recent N messages |
| getContacts | list contacts | limit | id, name, isMe | entry point |
| searchChats | find chats by name | query | id, name, isGroup | client-side filter |
| getChatById | chat detail | chatId ← getChats | archived, pinned, muted, lastMessage | |
| sendMessage | send text | chatId ← getChats, message | success, timestamp | write — internal module `sendTextMsgToChat` |
| deleteMessage | delete message | chatId ← getChats, messageId ← getMessages | success | write/caution — internal module `chat.deleteMessages()` |
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

# Delete a message (reverse of sendMessage)
openweb whatsapp exec deleteMessage '{"chatId": "1234567890@c.us", "messageId": "true_1234567890@c.us_ABCDEF"}'

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
| `WAWebSendTextMsgChatAction` | `sendTextMsgToChat` — send text message via internal WS |
| `WAWebSendMsgChatAction` | `addAndSendMsgToChat` — lower-level send (raw msg object) |
| `WAWebMsgKey` | Message key utilities |
| `WAWebMsgCollection` | Message collection model |

## Auth
QR code scan in headed browser. Session persists in browser profile. No standard auth primitive — adapter checks `ChatCollection.length > 0` to verify auth.

## Transport
`page` transport only. All operations execute via `page.evaluate()` against internal modules. Node transport is impossible — no HTTP API exists.

## Adapter Patterns
- **Shape:** `CustomRunner` with `run(ctx)` (migrated from `CodeAdapter` Phase 5C). File: `adapters/whatsapp-modules.ts`.
- **Inline `ensureReady` preamble:** unusual for this site — both `init()` and `isAuthenticated()` were folded into a single per-call preamble:
  - **Metro module-ready probe:** `page.evaluate(() => typeof require === 'function' && !!require('WAWebChatCollection'))` — waits for the WAWeb Metro module system to load. This is dynamic JS state beyond what PagePlan's CSS-selector ready check can express. Throws `errors.retriable` if not yet loaded.
  - **Chat collection probe:** checks `ChatCollection.getModelsArray().length > 0` — server-derived auth validity, not just credential presence. Throws `errors.needsLogin()` on empty collection.
- **Trade-off:** `ensureReady` runs on every `run()` call (vs once at init). Cost is two short `page.evaluate` calls — cheap, and eliminates the race where ops dispatched before modules were ready.

## Known Issues
- **QR scan required**: User must scan QR code in managed browser before operations work.
- **Binary WS**: Standard capture produces 0 usable API samples — adapter-only site.
- **All write ops use internal modules**: `sendTextMsgToChat` for sending, `chat.deleteMessages()` for deleting, `markConversationSeen` for read status. Zero DOM interaction.
- **Messages decrypted in memory only**: IndexedDB stores empty message bodies — messages only exist decrypted in the in-memory Store.
- **Module names may change**: Meta can rename `WAWeb*` module IDs in updates.
- **deleteMessage uses internal module**: Uses `chat.deleteMessages([id])` for "delete for me" — no DOM interaction, stable across UI updates.
