## 2026-03-31: Doc Verify — align DOC.md with site-doc template

**What changed:**
- Restructured DOC.md: added Workflows section, reordered to Workflows → Operations → Quick Start
- Operations table: replaced Method column with Key Input (← source) and Key Output columns
- Added data flow annotations (← getSubredditPosts) and entry point markers
- Added Site Internals divider

**Why:**
- DOC.md did not follow site-doc.md template — missing workflows, wrong table columns, no data flow graph

**Verification:** Doc Verify checklist pass. All 10 openapi.yaml operations present in Operations table. `openweb verify reddit` — 8/8 PASS.

## 2026-03-30: Release QA — full site audit

**What changed:**
- Fixed getPostComments example: `postId` -> `post_id` to match OpenAPI spec parameter name
- Added missing example files: getSubredditPosts, getPopularPosts, getUserPosts
- All 7 read operations now have example coverage (10 ops total, 3 write/auth ops excluded)

**Why:**
- Site package failed verification due to param name mismatch in example
- 3 read ops lacked example files, blocking full verify coverage

**Verification:** `pnpm dev verify reddit` — all 5 public ops PASS (getMe, getPostComments, getSubredditAbout, getUserProfile, searchPosts)
