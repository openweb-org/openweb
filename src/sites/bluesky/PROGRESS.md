## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 3 verified operations with AT Protocol XRPC pattern

**Verification:** spec review only — no new capture or compilation

## 2026-03-26: Expand coverage from 3 to 12 ops

**What changed:**
- Added 9 new operations: getPostThread, getAuthorFeed, getActorLikes, searchPosts, getPosts, getFollowers, getFollows, createRecord, deleteRecord
- 8 read operations covering timeline, posts, threads, search, social graph
- 2 write operations for like/repost/follow (and undo)
- Test files for all 10 read operations
- Updated DOC.md with full operation table and API architecture details

**Why:**
- Expand beyond the initial 3 ops to cover all major Bluesky user flows
- AT Protocol XRPC endpoints follow a consistent, well-documented pattern

**Verification:**
- 7/10 read ops verified PASS via public.api.bsky.app (no auth needed)
- 3 ops require auth: getTimeline, searchPosts, getActorLikes
- 2 write ops (createRecord, deleteRecord) require auth — not verified
- openweb verify hangs due to localStorage_jwt auth resolution requiring logged-in browser
