## 2026-03-26: Expand from 2 to 5 operations

**What changed:**
- Added getConversation (GET /conversation/{id}) — full message tree with mapping structure
- Added searchConversations (GET /conversations/search) — keyword search with snippet payload
- Added sendMessage (POST /f/conversation) — SSE-based chat completion (write op)
- Updated DOC.md with all 5 operations, API architecture notes, and SSE transport details
- Added test files for new operations

**Why:**
- Expand coverage to support reading full conversation history, searching past chats, and sending messages

**Verification:** Manual HTTP verification — all 3 new read ops return 200 with correct data. sendMessage confirmed via browser CDP traffic capture (SSE response).

## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 2 verified operations with exchange_chain auth and Cloudflare considerations

**Verification:** spec review only — no new capture or compilation
