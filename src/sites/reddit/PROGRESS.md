## 2026-04-24 — Userflow QA: response trimming via read adapter

**Context:** Reddit's JSON API returns ~102 fields per post object; the OpenAPI schema declares ~17. Responses were 24–59KB for 5 items, causing token waste when agents consume them. No response trimming existed — Reddit had no adapter (pure HTTP pass-through).

**Personas tested:**
1. Developer — searchPosts("React Server Components"), getSubredditPosts(r/programming, hot), getPostComments, getSubredditAbout
2. Investor — getSubredditPosts(r/wallstreetbets, hot), getPopularPosts, getPostComments, getSubredditAbout
3. Student — searchPosts("grad school computer science"), getUserProfile, getUserPosts

**All 11 calls returned HTTP 200 with valid data. No bot detection or rate limiting.**

**Findings:**
- P0: Response bloat — 102 fields per post vs 17 declared (56KB → should be ~22KB for 5 posts)
- P1: searchPosts uses global `/search.json`, can't scope to a specific subreddit (Reddit supports `/r/{sub}/search.json` but not wired). Documented, not fixed.
- Cosmetic: `accounts_active: null` in getSubredditAbout — Reddit API behavior for unauthenticated requests, already nullable in schema.

**Changes:**
- Created `adapters/reddit-read.ts` — handles all 7 unauthenticated read operations with field-level response trimming. Uses direct `fetch` (no browser needed). Trims posts to 18 fields, comments to 11 fields, user profiles to 13 fields, subreddit about to 16 fields.
- Updated `openapi.yaml` — added `transport: node` + `adapter` ref to each read operation. Added `upvote_ratio` and `link_flair_text` fields to post listing schemas (getSubredditPosts, getPopularPosts, searchPosts).

**Size reduction (5 items):**
| Operation | Before | After | Reduction |
|---|---|---|---|
| getSubredditPosts (5) | 56,170 | 22,268 | 60% |
| searchPosts (5) | 27,592 | 8,264 | 70% |
| getPostComments (3) | 28,031 | 8,397 | 70% |
| getPopularPosts (5) | 21,428 | ~3,600 | 83% |
| getUserProfile | ~4,000 | ~500 | 87% |
| getSubredditAbout | 7,831 | ~1,800 | 77% |

**Verification:** `pnpm dev verify reddit` — 9/9 PASS (all read + auth ops), no schema warnings.

## 2026-04-20 — Fixture refresh (handoff5)

**Context:** `createComment` failing in handoff4 because pinned `thing_id` (`t3_1jzzq4z`, then `t3_1si747w`) had been deleted/archived upstream. Reddit silently spam-filters stale-thread comments without surfacing a clean error.
**Changes:** Rotated `createComment.example.json` `thing_id` to live r/learnprogramming thread `t3_1sqc9f1` and replaced the comment body with a 60-word substantive on-topic reply per `feedback_hn_comment_text.md`. Live thread sourced via `openweb reddit getSubredditPosts`. (commit 1982640)
**Verification:** `pnpm dev verify reddit --browser --write` 16/16 PASS.
**Key discovery:** `t3_*` IDs in fixtures should be re-derived from `getSubredditPosts(sort:new)` rather than hand-pinned, but cross-op chaining isn't wired here yet — documenting the refresh recipe in DOC.md is the cheap fix.

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
