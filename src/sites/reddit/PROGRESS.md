## 2026-04-18 — Write-op verify fix
**Context:** `vote` and `savePost` were defined in `openapi.yaml` and have read→write workflows in SKILL.md, but had no `example.json` fixtures. Verify silently skipped them ("0/0 ops") because `--ops <name>` filter found no matching example file.
**Changes:** Added `examples/vote.example.json` (id=t3_1si747w, dir=1) and `examples/savePost.example.json` (id=t3_1si747w) — both target the test post owned by the verify account, consistent with other reddit write ops. (commit b8d1055)
**Verification:** 2/2 PASS — vote, savePost.
**Key discovery:** Same root cause flagged across the campaign — write ops without `example.json` files appear green because the verify dispatcher has nothing to run. Audit fixture coverage, not just spec coverage.

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
