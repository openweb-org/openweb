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
