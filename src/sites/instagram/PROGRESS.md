## 2026-03-28: Initial compile (rediscovery)

**What changed:**
- Compiled 9 HTTP operations for 5 target intents
- Auth: cookie_session + CSRF (csrftoken → x-csrftoken), Transport: page
- Operations: getUserProfile, getUserPosts, getMediaInfo, getMediaComments, searchUsers, searchContent, getExploreGrid, getReelsTray, getTimeline

**Why:**
- Clean rediscovery from scratch — no existing site package

**Verification:** All 9 operations return real data via exec with page transport
