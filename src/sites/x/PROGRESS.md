## 2026-04-19 — Handoff2 cleanup: drop deleteDM, restore hide/unhideReply

**Context:** Write-verify campaign handoff2 items #5a (deleteDM probe-rediscover) and #7 (hide/unhideReply permanent fixture).
**Changes:**
- Dropped `deleteDM` entirely — removed `/internal/deleteDM` from `openapi.yaml`, `OP_NAME.deleteDM` and the `deleteDM` handler from `adapters/x-graphql.ts`, and `examples/deleteDM.example.json.skip`.
- Restored `hideReply`/`unhideReply` from `.skip` to live fixtures — both hard-code reply id `2046061970021847164` (from `@QGuo219895` on `@iamoonkey/2045749343437619246`); `unhideReply` chains at `order: 2`.
**Verification:** `pnpm dev x` confirms `deleteDM` gone from listings; hide/unhide fixtures land structurally (verify run blocked on a separate auth-refresh issue, not the fixture content).
**Key discovery:** Twitter's `DMMessageDeleteMutation` queryId (currently `BJ6DtxA2llfjnRoRjaiIiw`) lives in a webpack chunk that's only fetched when the user clicks "Delete for you" inside an open DM thread — not in main.js, not in any chunk loaded by `/messages` or by opening a conversation. Brute-scanning all 20k registered chunk URLs and filtering by name (`DM`/`DirectMessage`/`Conversation`/`Drawer`/`XChat`/`Compose`) returned zero hits for the operation name. Lazy-loaded chunks behind a destructive UI gesture aren't worth chasing for an op without an external test partner; the cleaner answer is dropping the op until either a chunk-stable discovery path emerges or the value justifies the fragility.
**Pitfalls:** The earlier `sendDM` example used `recipient_ids` and 403'd against the user's own id; switching to `conversation_id: '4211243893-4211243893'` for self-DM works but the `sendDM` example wasn't on the path of this task.



**Context:** Post-`acc23ad` cascade fix left x at 8/14. The remaining 6 ops (followUser, blockUser, muteUser, unmuteUser, hideReply, unhideReply) consistently timed out at 45 s in `verify --write` despite the cascade fix.
**Changes:**
- `src/sites/x/examples/{follow,block,mute,unfollow,unblock,unmute}User.example.json`: `userId 4211243893` → `2244994945` (@XDevelopers, stable third-party).
- `src/sites/x/examples/{hide,unhide}Reply.example.json`: `tweet_id 2042768913184792832` → `2045740947703562740` — a real reply created via the `reply` op against MoonkeyX's pinned tweet (the parent owner is the authenticated user, so PUT `/i/api/2/tweets/{id}/hidden` is permitted).
- All 8 example files: added `order: 1..8` to interleave each create immediately before its destroy. Prevents cross-pair contamination (e.g. `blockUser` auto-unfollowing the target before the follow pair completes).
**Verification:** Standalone `pnpm dev x exec` now confirms all 6 user-graph ops return 200 with the new `userId`. Aggregate `pnpm dev verify x --write --browser` still returns 2/8 PASS for this set — verify-framework cascade keeps killing+restarting Chrome between ops, leaving stale state (port-bound errors, queryId cache lost). Remaining gap is in the verify framework, not the site fixtures.
**Key discovery:** The original `userId 4211243893` was the logged-in account itself (@iamoonkey). Twitter returns 403 with `code 158/147/271 — "you can't follow/block/mute yourself"`. The runtime maps any 401/403 to `needs_login` → `handleLoginRequired()` opens a system browser and polls for login until the per-op 45 s budget expires. The destroy variants (unfollow/unblock/unmute) returned 200 no-op even on self, masking the misdiagnosis. Lesson: **never use the test account's own ID as a fixture for write ops where the verb is reflexive-restricted.**
**Pitfalls encountered:**
- Multiple Chromes split-brain on port 9222 mid-session (untracked PID owning the port, tracked PID dead) — `pnpm dev browser stop && start` cleanly resolves; `kill <pid>` then rewriting `~/.openweb/browser.{pid,port,profile}` is fragile because verify keeps cleaning up the state files.
- Twitter's anti-abuse rate limiter throttles after ~10 cycles of follow/unfollow on a single test account in <5 min, then surfaces as 429 and even read-op queryId failures.
- adapter `.ts` edits don't reach runtime when the bundled `.js` (built via `node scripts/build-adapters.js`) is stale-newer; `loadAdapter()` prefers `.ts` only when `process.argv[1]?.endsWith('.ts')`. Re-run `node scripts/build-adapters.js` after debug instrumentation OR confirm `.ts`-preference path before adding logging.

## 2026-04-18 — Write-Verify: page_plan + runtime cascade unlock

**Context:** First end-to-end `verify --write` sweep across all 33 sites with write ops. x reported `No browser context available` on every op (0/14 PASS) regardless of fixture quality.
**Changes:**
- Site (commit `ce51384`): added `page_plan.entry_url=https://x.com/home` with `warm: true` so a fresh verify session navigates the managed Chrome to home before dispatch, hydrating cookies, ct0 CSRF, and the webpack signing module.
- Runtime (commit `acc23ad`): stopped pre-acquiring a `Browser` handle in `commands/verify.ts`. Each op now calls `ensureBrowser()` to re-read the live CDP port. Fixes the cascade where `handleLoginRequired() → refreshProfile()` killed + restarted Chrome and left verify dispatching against a dead port.
**Verification:** 0/14 → 8/14 PASS — `likeTweet`, `unlikeTweet`, `createBookmark`, `deleteBookmark`, `createRetweet`, `deleteRetweet`, `unblockUser`, `unfollowUser`. See DOC.md "Verify quirk" for the remaining 6 (followUser/blockUser/muteUser/unmuteUser/hideReply/unhideReply) and their per-op hypotheses.
**Key discovery:** A site-level `page_plan.entry_url` is necessary but not sufficient when the runtime cascade can recycle the browser between ops. Any executor that caches a `Browser` reference across an op loop is fragile if a downstream primitive can trigger a profile-refresh kill+restart. Fix the executor, not the site.
**Pitfalls:** Initially attributed all 14 failures to the `CustomRunner` migration (`e944c0b`), but the regression was actually upstream in the runtime cascade — the migration was byte-for-byte equivalent at the adapter layer.

## 2026-04-17 — Adapter Refactor

**Context:** Site-adapter normalization (Phase 5C, commit e944c0b). The `x-graphql` adapter was the last `CodeAdapter`-shaped adapter in the repo and needed to align with the new `CustomRunner` contract used across other sites.
**Changes:**
- Migrated `src/sites/x/adapters/x-graphql.ts` from `CodeAdapter` (with `init` / `isAuthenticated` / `execute`) to `CustomRunner` exposing a single `run(ctx)` entrypoint (697 → 715 lines; the increase is per-op `const { errors } = helpers` unpacks).
- Dropped `init()` — was a trivial URL check.
- Dropped `isAuthenticated()` — was a cookie probe (`auth_token` / `twid`) that never hit the server. Runtime auth-primitive resolution already covers credential-configured semantics.
- Per-op semantics preserved byte-for-byte: OP_NAME mutation, `cachedQueryIds`, `DEFAULT_FEATURES`, signing / `x-client-transaction-id` logic, HomeTimeline + Bookmarks queryId discovery, REST paths and bodies.
**Verification:** 9/11 ops PASS. The 2 failures (`getUserFollowers` HTTP 404, `searchTweets` HTTP 404) pre-exist this refactor — both are upstream Twitter API drift, not migration regressions.
**Key files:** `src/sites/x/adapters/x-graphql.ts`

## 2026-04-02: L3 adapter — dynamic hashes + request signing

**What changed:**
- Added `x-graphql` adapter that resolves GraphQL query hashes at runtime from the main.js webpack bundle (no hardcoded hashes)
- Added `x-client-transaction-id` signing via Twitter's own webpack signing function (module 938838, export `jJ`) — required for Followers and SearchTimeline endpoints
- Bearer token + CSRF handled inline by adapter (removed constant_headers hack)
- Rewired all 14 ops to adapter, removed `{id}`/`variables`/`features` params — users now pass clean params (e.g., `screen_name`, `userId`, `rawQuery`)
- Removed searchTypeahead (REST v1.1 endpoint deprecated, returns 410)
- Fixed `encodeQueryValue` in request-builder.ts — was not encoding `{`, `}`, `"` in query strings, causing Twitter 400s

**Why:**
- Query hashes rotate on every Twitter deploy (several times per week) — hardcoded hashes broke within hours
- Followers and SearchTimeline returned 404 without `x-client-transaction-id` signing
- browser_fetch path couldn't construct valid requests (missing Bearer token, wrong URL encoding)

**Verification:** 8/8 PASS — `pnpm --silent dev verify x`
**Commit:** pending

## 2026-04-01: Initial discovery and compile

**What changed:**
- Discovered x.com (Twitter) GraphQL API from scratch
- Captured traffic via UI browsing: timeline, search, profiles, followers, tweet detail
- Captured write ops: like/unlike, bookmark/unbookmark, retweet/unretweet
- Compiled 15 curated operations from 50 raw clusters (35 noise removed)
- Configured page transport + ct0 CSRF with ALL-methods scope

**Why:**
- First full site package for x.com

**Verification:** openweb verify x — page transport with browser
**Commit:** pending
