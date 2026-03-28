## 2026-03-28: Initial compile (clean rediscovery)

**What changed:**
- Compiled 8 HTTP operations covering 5 target intents
- Auth: none (public JSON API), Transport: node
- Operations: getHomeFeed, getSubredditPosts, getSubredditSorted, getSubredditAbout, searchPosts, getUserAbout, getUserSubmitted, getUserComments

**Why:**
- Clean rediscovery for pipeline v2 comparison — no prior site package used
- Discovered that Reddit's modern frontend (shreddit) uses SSR, so navigated to `.json` URLs directly

**Verification:** all 8 operations return HTTP 200 with valid JSON data via exec
