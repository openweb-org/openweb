## 2026-03-26: Expand coverage from 3 to 12 operations

**What changed:**
- Added 9 new operations: getUserPosts, getMediaInfo, getMediaComments, searchUsers, getReelsTray, getUserStories, unlikeMedia, followUser, bookmarkMedia
- 8 read ops + 4 write ops (all write ops are safe/reversible)
- Created test files for all 8 read operations
- Updated DOC.md with full operation table and dependencies

**Why:**
- Expand Instagram coverage to match social media archetype expectations
- Cover core user flows: timeline, profile, posts, comments, search, stories, interactions

**Verification:** All endpoints returned HTTP 200 via browser fetch during CDP capture session. Formal `openweb verify` blocked by CDP port contention with concurrent captures.

---

## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 3 operations (2 verified read, 1 unverified write)

**Verification:** spec review only — no new capture or compilation
