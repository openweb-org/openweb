## 2026-04-01: v2.0 — expanded to 6 operations

**What changed:**
- Expanded from 3 to 6 operations: getChats, getMessages, searchMessages, getUserInfo, getMe, sendMessage
- Renamed getDialogs → getChats for consistency
- Added richer response fields: senderName, isOutgoing, membersCount, lastMessageDate
- Added searchMessages (in-memory text search across loaded messages)
- Added getUserInfo (user profile lookup by ID)
- Added sendMessage (write op via DOM interaction)
- Rewrote adapter with extracted operation handlers for maintainability

**Why:**
- Prior package only had basic read operations; messaging archetype expects search, contacts, and write operations

**Verification:** adapter-level (requires logged-in browser session)
**Commit:** pending
