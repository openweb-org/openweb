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
