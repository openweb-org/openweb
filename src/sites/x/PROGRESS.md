## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 2 verified operations with complex multi-layer auth

**Verification:** spec review only — no new capture or compilation

## 2026-03-26: Expand coverage from 2 to 16 operations

**What changed:**
- Added 14 new operations via GraphQL API capture
- Read ops: getHomeTimeline, searchTweets, getUserTweets, getTweetDetail, getTweetById, getExplorePage, getUserProfile, getBookmarks
- Write ops: likeTweet, unlikeTweet, retweet, undoRetweet, bookmarkTweet, unbookmarkTweet
- Curated from 38 compiled operations down to 16 (removed noise: analytics, ads, internal UI)
- Updated DOC.md with full operation table and architecture notes
- Added test files for 8 read operations

**Why:**
- Site had only 2 ops (listFollowing, listFollowers) — missing core functionality
- Target: timeline, search, tweet detail, user profile, trending, bookmarks, write ops

**Verification:**
- API-level: 8/9 read ops PASS via `openweb verify x`
- searchTweets returns HTTP 404 (suspected GraphQL hash rotation) — noted as known issue
- Write ops not verified (verify skips writes by default)
- All operations captured and compiled from live browser traffic
