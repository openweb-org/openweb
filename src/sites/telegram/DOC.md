# Telegram Web A

## Overview
Telegram Web A — messaging platform. L3 adapter-based extraction from teact global state via webpack module walk.

## Workflows

### Read messages in a chat
1. `getChats` → pick chat → `chatId`
2. `getMessages(chatId, limit)` → messages with sender info

### Search for messages
1. `searchMessages(query)` → matching messages across all chats
2. `searchMessages(query, chatId)` → search within a specific chat

### Look up a user
1. `getChats` → find chat with user → note `senderId` from messages
2. `getUserInfo(userId)` → full profile (username, status, premium)

### Send a message (CAUTION)
1. `getChats` → pick chat → `chatId`
2. `sendMessage(chatId, text)` → sends text message

### Delete a message (CAUTION)
1. `getChats` → pick chat → `chatId`
2. `getMessages(chatId)` → find message → `messageId`
3. `deleteMessage(chatId, messageId)` → deletes the message

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getChats | list conversations | limit? | id, title, type, membersCount | entry point |
| getMessages | read chat history | chatId ← getChats, limit?, offsetId? | id, text, senderName, date | paginated via offsetId |
| searchMessages | find messages by keyword | query, chatId? ← getChats | id, text, chatTitle, senderName | searches loaded messages only |
| getUserInfo | view user profile | userId ← getMessages.senderId | firstName, username, status, isPremium | returns null if not found |
| getMe | current user info | — | id, firstName, username | no params needed |
| sendMessage | send text to chat | chatId ← getChats, text | success, chatId, text | write op, CAUTION |
| deleteMessage | delete a message | chatId ← getChats, messageId ← getMessages | success, chatId, messageId | write op, CAUTION, reverse of sendMessage |

## Quick Start

```bash
# List your chats
openweb telegram exec getChats '{"limit": 20}'

# Read messages from a chat
openweb telegram exec getMessages '{"chatId": "-1001234567890", "limit": 30}'

# Search messages globally
openweb telegram exec searchMessages '{"query": "hello", "limit": 10}'

# Search within a specific chat
openweb telegram exec searchMessages '{"query": "meeting", "chatId": "-1001234567890"}'

# Get a user's profile
openweb telegram exec getUserInfo '{"userId": "123456789"}'

# Get your own profile
openweb telegram exec getMe '{}'

# Delete a message from a chat (requires chatId + messageId)
openweb telegram exec deleteMessage '{"chatId": "-1001234567890", "messageId": 42}'
```

---

## Site Internals

## API Architecture
- **No REST API** — all operations use `telegram-protocol` adapter
- `/internal/*` paths are virtual — adapter reads from Telegram Web A's teact global state
- Chat IDs are numeric strings (e.g. `-1001625429257`, private chats are positive)
- The adapter walks `webpackChunktelegram_t` modules to find `getGlobal()`
- Module IDs and export names are mangled and change per deploy — dynamic discovery required

## Auth
- Requires Telegram Web A to be logged in (session in browser)
- Auth is implicit — adapter reads from app's in-memory state, no explicit cookie/token auth
- `getGlobal()` returns state only after successful login + app hydration

## Transport
- `page` — requires Telegram Web A (`web.telegram.org/a/`) loaded in a browser tab
- Cannot use `node` transport — all data comes from in-memory SPA state

## Known Issues
- **searchMessages only searches loaded messages** — Telegram Web A only stores recently-viewed messages in memory. For comprehensive search, the user must have scrolled through the target chats first.
- **sendMessage uses DOM interaction** — types into the compose input and clicks send. The target chat must be the currently-open chat in the browser.
- **deleteMessage uses DOM interaction** — right-clicks the message, selects "Delete" from the context menu, and confirms. The message must be visible in the current chat view. Only works on messages you have permission to delete.
- **Module ID instability** — webpack module IDs change on every Telegram deploy. The adapter finds `getGlobal` dynamically by testing return shapes, but a breaking change to the global state structure would require adapter updates.
