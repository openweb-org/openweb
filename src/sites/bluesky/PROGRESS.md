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

## 2026-04-17 — Adapter Refactor

**Context:** Phase 5C normalization — migrate bluesky-pds adapter from legacy `CodeAdapter` lifecycle (`init`/`isAuthenticated`/`execute`) to the simpler `CustomRunner` (`run(ctx)`) shape.
**Changes:**
- `src/sites/bluesky/adapters/bluesky-pds.ts`: 297 → 272 lines, single `run(ctx)` entry dispatching via an `OPERATIONS` table.
- Dropped `init()` (only navigated to bsky.app — redundant with PagePlan).
- Dropped `isAuthenticated()` (pure localStorage read couldn't validate server state); `requireSession` already throws `errors.needsLogin()` and `pdsGet`/`pdsPost` surface token errors.
- Collapsed per-op top-level consts into the `OPERATIONS` table; all 14 operations preserved byte-for-byte.
**Verification:** 10/10 ops PASS.
**Key files:** `src/sites/bluesky/adapters/bluesky-pds.ts`
