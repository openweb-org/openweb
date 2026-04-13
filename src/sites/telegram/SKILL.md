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
