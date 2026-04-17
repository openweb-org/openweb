# Telegram

## Overview
Telegram — messaging platform. L3 adapter reads via webpack `getGlobal()`, writes via `callApi()` to GramJS Web Worker. Zero DOM manipulation.

## Workflows

### Read messages in a chat
1. `getChats` → pick chat → `chatId`
2. `getMessages(chatId, limit)` → messages with sender info

### Search for messages
1. `searchMessages(query)` → matching messages across all loaded chats
2. `searchMessages(query, chatId)` → search within a specific chat

### Send, edit, then delete
1. `getChats` → pick chat → `chatId`
2. `sendMessage(chatId, text)` → sends message
3. `getMessages(chatId, limit: 1)` → get `messageId`
4. `editMessage(chatId, messageId, newText)` → edits the message
5. `deleteMessage(chatId, messageId)` → deletes it

### Forward a message
1. `getMessages(fromChatId)` → find message → `messageId`
2. `forwardMessages(fromChatId, toChatId, [messageId])` → forwarded

### Pin a message
1. `getMessages(chatId)` → find message → `messageId`
2. `pinMessage(chatId, messageId)` → pinned
3. `unpinMessage(chatId, messageId)` → unpinned

### Look up a user
1. `getChats` → find chat with user → note `senderId` from messages
2. `getUserInfo(userId)` → full profile (username, status, premium)

### Browse contacts
1. `getContacts` → full contact list with phone numbers and status

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getChats | list conversations | limit? | id, title, type, membersCount | entry point |
| getMessages | read chat history | chatId ← getChats, limit?, offsetId? | id, text, senderName, date | paginated via offsetId |
| searchMessages | find messages by keyword | query, chatId? ← getChats | id, text, chatTitle, senderName | searches loaded messages only |
| getUserInfo | view user profile | userId ← getMessages.senderId | firstName, username, status, isPremium | null if not found |
| getMe | current user info | — | id, firstName, username | no params |
| getContacts | list contacts | — | id, firstName, phoneNumber, status | reads from cached contacts |
| sendMessage | send text to chat | chatId ← getChats, text | success, chatId, text | callApi write |
| deleteMessage | delete a message | chatId ← getChats, messageId ← getMessages | success, chatId, messageId | callApi write, supports "latest" |
| editMessage | edit message text | chatId, messageId ← getMessages, text | success, chatId, messageId, text | callApi write |
| forwardMessages | forward messages | fromChatId, toChatId ← getChats, messageIds ← getMessages | success, fromChatId, toChatId | callApi write |
| pinMessage | pin a message | chatId, messageId ← getMessages, silent? | success, chatId, messageId | callApi write |
| unpinMessage | unpin a message | chatId, messageId | success, chatId, messageId | callApi write, reverse of pinMessage |
| markAsRead | mark chat as read | chatId ← getChats | success, chatId | callApi write |

## Quick Start

```bash
# List your chats
openweb telegram exec getChats '{"limit": 20}'

# Read messages from a chat
openweb telegram exec getMessages '{"chatId": "8259810574", "limit": 10}'

# Search messages globally
openweb telegram exec searchMessages '{"query": "hello", "limit": 10}'

# Get your contacts
openweb telegram exec getContacts '{}'

# Send a message
openweb telegram exec sendMessage '{"chatId": "8259810574", "text": "hello"}'

# Edit a message
openweb telegram exec editMessage '{"chatId": "8259810574", "messageId": 153, "text": "edited"}'

# Delete the latest outgoing message
openweb telegram exec deleteMessage '{"chatId": "8259810574", "messageId": "latest"}'

# Forward a message
openweb telegram exec forwardMessages '{"fromChatId": "8259810574", "toChatId": "5527097202", "messageIds": [153]}'

# Mark chat as read
openweb telegram exec markAsRead '{"chatId": "8259810574"}'
```

---

## Site Internals

## API Architecture
- **No REST/HTTP API** — all ops go through `telegram-protocol` adapter
- `/internal/*` paths are virtual — adapter reads from teact global state or calls GramJS
- Two data paths:
  - **Reads**: `getGlobal()` — synchronous access to webpack-cached app state
  - **Writes**: `callApi()` — async dispatch to GramJS Web Worker → MTProto → Telegram servers
- Chat IDs are numeric strings (negative = groups/channels, positive = private chats)
- Module IDs are mangled per deploy — adapter discovers `getGlobal`/`callApi` dynamically

## Auth
- Requires Telegram Web A/K to be logged in (session in browser)
- Auth is implicit — adapter reads from the app's in-memory state
- `getGlobal().currentUserId` confirms authentication
- chatId aliases: `"me"` → Saved Messages, `"+1234567890"` → phone lookup

## Transport
- `page` — requires `web.telegram.org/a/` (or `/k/`) loaded in a browser tab
- Supports both Web A (teact, `webpackChunktelegram_t`) and Web K (`webpackChunkwebk`)
- Cannot use `node` transport — all data comes from in-memory SPA state + GramJS Worker

## Adapter Patterns
- `adapters/telegram-protocol.ts` exports a **`CustomRunner`** (`{ run(ctx) }`), not a `CodeAdapter`. The runner dispatches by `ctx.operation` to per-op handlers and is invoked directly by the runtime — no separate `init()` / `isAuthenticated()` lifecycle.
- **Inline "Many logins" check** in `run()` preamble: before dispatch, the runner does `page.evaluate(() => document.body?.innerText?.includes('Many logins'))` and throws `helpers.errors.fatal(...)` if Telegram is showing the conflict screen. This replaces the old `init()` precheck and gives an explicit error instead of silent webpack-not-ready failures downstream.
- Param validation uses `helpers.errors.missingParam(name)` for required-field checks (uniform classification with the rest of the codebase).
- Webpack discovery (`findGetGlobal`, `findCallApi`) is serialized into `page.evaluate` via `.toString()` — module IDs are mangled per deploy, so finders test return shape (`{chats, users}`) and source-string heuristics (`callMethod` + `cancelApiProgress`) instead of fixed IDs.
- Shared `resolveCtx(globalSrc, apiSrc, chatId)` helper bootstraps both functions inside the page and resolves chatId aliases (`me`, `+phone`, raw ID) for every write op.

## Known Issues
- **searchMessages only searches loaded messages** — TG Web A caches recently-viewed messages. For comprehensive search, the user must have scrolled through target chats.
- **getContacts reads cached contacts** — only returns contacts that TG Web A has loaded into state.
- **Module ID instability** — webpack module IDs change on every TG deploy. The adapter finds `getGlobal`/`callApi` by testing return shapes and scanning source strings, not by ID.
- **getChats DRIFT** — `membersCount` is absent for private chats, causing minor schema drift in verify.
