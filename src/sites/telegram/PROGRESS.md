## 2026-04-10: v3.0 — callApi writes + 6 new operations (13 total)

**What changed:**
- Rewrote all write ops from DOM manipulation to `callApi()` (GramJS Web Worker)
- sendMessage: DOM keyboard → `callApi('sendMessage', {chat, text})`
- deleteMessage: DOM right-click context menu → `callApi('deleteMessages', {chat, messageIds})`
- Added 6 new operations: getContacts, editMessage, forwardMessages, pinMessage, unpinMessage, markAsRead
- Extracted shared `resolveCtx()` helper for chatId resolution (me, +phone, raw ID)
- Added `findCallApi()` webpack scanner — locates callApi by "callMethod"+"cancelApiProgress" string constants
- deleteMessage now supports `messageId: "latest"` (resolves to most recent outgoing from state)

**Why:**
- DOM-based writes were fragile (depended on CSS selectors, context menus, confirm dialogs)
- callApi goes directly to GramJS Worker → MTProto, completely bypassing the DOM
- Architecture: reads via getGlobal (webpack state), writes via callApi (GramJS Worker)

**Verification:** 7/7 ops PASS in `verify --write --browser`, new ops exec-tested individually
**Commit:** pending

## 2026-04-10: v2.1 — fixed sendMessage + deleteMessage DOM approach

**What changed:**
- sendMessage: added chat navigation (sidebar click + search fallback)
- deleteMessage: fixed DOM selectors, added modal dismissal, chat navigation
- Discovered TG Web A ignores post-boot hash changes — sidebar click is the only reliable navigation
- Fixed chatId resolution to not treat numeric IDs as phone numbers

**Why:**
- Both write ops failed in verify — sendMessage didn't navigate to chat, deleteMessage used stale selectors

**Verification:** 6/7 PASS (getChats DRIFT on membersCount)

## 2026-04-01: v2.0 — expanded to 7 operations

**What changed:**
- Expanded from 3 to 7 operations: getChats, getMessages, searchMessages, getUserInfo, getMe, sendMessage, deleteMessage
- Renamed getDialogs → getChats for consistency
- Added richer response fields: senderName, isOutgoing, membersCount, lastMessageDate

**Why:**
- Prior package only had basic read operations; messaging archetype expects search, contacts, and write operations

**Verification:** adapter-level (requires logged-in browser session)
