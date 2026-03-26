## 2026-03-26: Expand coverage from 3 to 10 operations

**What changed:**
- Added 7 new operations: getPost, searchPosts, getSubredditAbout, getUserProfile, getUserHistory, getPopular, savePost
- All new read ops use www.reddit.com `.json` suffix pattern (same as existing getSubreddit)
- Updated manifest.json operation count (3 → 10)
- Updated DOC.md with full operation table

**Why:**
- Expand Reddit coverage for post detail, search, user profiles, subreddit info, and bookmarking

**Verification:** Manual spec authoring based on Reddit's well-known `.json` API convention. Compile hung on large 38MB HAR capture — operations not yet verified via `openweb verify`.

---

## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 3 operations with dual-server auth architecture

**Verification:** spec review only — no new capture or compilation
