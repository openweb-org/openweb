# WhatsApp Web — Progress

## 2026-04-01: Full rediscovery (adapter-only)

**What changed:**
- Standard capture attempted: 2 requests, 0 WS, 0 usable API samples (encrypted binary WS)
- Confirmed adapter-only path: Metro-style `require('WAWeb*')` module system
- 7 operations: getChats, getMessages, getContacts, searchChats, getChatById, sendMessage, markAsRead
- All operations use page transport + adapter (no HTTP API exists)

**Why:**
- Rediscovery from scratch — prior package deleted from worktree
- WhatsApp Web uses Signal Protocol encrypted binary WebSocket, no REST/GraphQL

**Verification:** adapter probe confirmed module system accessible, collections available
