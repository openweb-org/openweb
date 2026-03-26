## 2026-03-26: Expand from 1 to 10 operations

**What changed:**
- Added 9 new operations: getNewestStories, getBestStories, getAskStories, getShowStories, getJobPostings, getFrontPageStories, getStoryDetail, getStoryComments, getUserProfile
- Created adapter (`adapters/hackernews.ts`) for parameterized operations (story detail, comments, user profile)
- Added `age` field to existing getTopStories operation
- Used shared component schema for feed operations
- Updated DOC.md with full operation table and architecture notes

**Why:**
- Site coverage audit identified hackernews as HIGH priority (1 op, missing obvious core functionality)
- 10 operations now cover: all feed types, story detail with comments, user profiles

**Verification:** Manual exec verification of all 10 operations via `openweb hackernews exec`. Feed pages return 30 items each. Story detail returns full comment tree with nesting. User profile returns username/karma/created/about.

---

## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 1 verified operation using DOM extraction pattern

**Verification:** spec review only — no new capture or compilation
