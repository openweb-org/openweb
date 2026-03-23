# Xiaohongshu Fixture Progress

## 2026-03-23: Initial discovery and fixture creation

**What changed:**
- Discovered XHS API architecture: Vue 3 SSR with `__INITIAL_STATE__`, all REST APIs gated by anti-bot signatures
- Built L3 adapter with 3 operations: searchNotes, getNoteDetail (with comment interception), getUserProfile
- searchNotes: extracts from Vue SSR state, returns 40+ notes with title/author/likes/cover
- getNoteDetail: extracts note from SSR + intercepts comment API response (10+ comments per page)
- getUserProfile: extracts from SSR state — nickname, bio, follower counts, tags

**Why:**
- Expanding openweb coverage to Chinese social media platforms
- XHS is one of the largest Chinese lifestyle/social platforms

**Verification:**
- API-level: searchNotes PASS, getNoteDetail PASS, getUserProfile FAIL (CAPTCHA rate limit)
- Content-level: search returns 40 notes matching keyword, note detail returns full content with 6 tags and 10 comments with like counts, user profile returns complete profile when not rate-limited

**Known issues:**
- getUserProfile triggers CAPTCHA under rapid navigation. Works when browser session is fresh.
