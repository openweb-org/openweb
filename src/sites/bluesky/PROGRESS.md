## 2026-04-01: Initial discovery and compilation

**What changed:**
- Discovered Bluesky AT Protocol API at public.api.bsky.app
- 9 operations: getProfile, getAuthorFeed, getPostThread, getFeed, searchPosts, searchActors, getFollowers, getFollows, getPosts
- Manual spec curation required — compiler path normalization merged all XRPC methods into single parameterized endpoint
- Public API (no auth) for 8/9 operations; searchPosts requires auth (403)

**Why:**
- Net-new site discovery targeting user-requested operations (getFeed, getPost, getProfile, searchPosts, getNotifications)
- getNotifications excluded — requires auth not available on public API

**Verification:** Runtime verify 8/9 public operations pass, searchPosts expected 403
**Commit:** pending
