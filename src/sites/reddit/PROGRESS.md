## 2026-03-30: Release QA — full site audit

**What changed:**
- Fixed getPostComments example: `postId` -> `post_id` to match OpenAPI spec parameter name
- Added missing example files: getSubredditPosts, getPopularPosts, getUserPosts
- All 7 read operations now have example coverage (10 ops total, 3 write/auth ops excluded)

**Why:**
- Site package failed verification due to param name mismatch in example
- 3 read ops lacked example files, blocking full verify coverage

**Verification:** `pnpm dev verify reddit` — all 5 public ops PASS (getMe, getPostComments, getSubredditAbout, getUserProfile, searchPosts)
