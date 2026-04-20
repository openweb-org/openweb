# X (Twitter)

## Overview
Social media and microblogging platform. Archetype: Social Media. GraphQL API with persisted query hashes, L3 adapter for dynamic hash resolution and request signing. REST v1.1/v2 endpoints for social graph and moderation actions.

## Workflows

### Browse timeline and interact
1. `getHomeTimeline` → tweets with tweet_id
2. `likeTweet(tweet_id)` / `createBookmark(tweet_id)` / `createRetweet(tweet_id)`

### Compose and manage tweets
1. `createTweet(text)` → new tweet with rest_id
2. `reply(tweet_id, text)` → reply to a tweet
3. `deleteTweet(tweet_id)` → delete your own tweet

### Find and read a user's profile
1. `getUserByScreenName(screen_name)` → `rest_id` (userId), bio, follower counts
2. `getUserTweets(userId)` → user's tweets
3. `getUserLikes(userId)` → user's liked tweets
4. `getUserFollowers(userId)` / `getUserFollowing(userId)` → follower/following lists

### Manage social graph
1. `getUserByScreenName(screen_name)` → `rest_id`
2. `followUser(userId)` / `unfollowUser(userId)`
3. `blockUser(userId)` / `unblockUser(userId)`
4. `muteUser(userId)` / `unmuteUser(userId)`

### Search tweets
1. `searchTweets(rawQuery)` → tweet results with cursor pagination

### Get tweet with replies
1. `getTweetDetail(focalTweetId)` → full tweet thread with replies

### Moderate replies
1. `hideReply(tweet_id)` / `unhideReply(tweet_id)` — hide/show replies on your tweets

### Direct messages
1. `getUserByScreenName(screen_name)` → `rest_id`
2. `sendDM(recipientId, text)` — approved contacts only

### Notifications and bookmarks
1. `getNotifications` → mentions, likes, retweets, follows
2. `getBookmarks` → your bookmarked tweets

### Trending / Explore
1. `getExplorePage` → trending topics, recommended content

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getHomeTimeline | home feed | count | tweets, cursors | entry point, paginated |
| getTweetDetail | tweet + replies | focalTweetId | tweet thread, reply entries | also serves as getThread |
| getUserByScreenName | user profile | screen_name | rest_id, name, bio, followers_count | entry point |
| searchTweets | search posts | rawQuery, product (Top/Latest) | tweet results, cursors | paginated |
| getUserTweets | user's tweets | userId ← getUserByScreenName rest_id | tweets, cursors | paginated |
| getUserFollowers | followers list | userId ← getUserByScreenName rest_id | user profiles, cursors | paginated |
| getUserFollowing | following list | userId ← getUserByScreenName rest_id | user profiles, cursors | paginated |
| getExplorePage | trending/explore | — | trending topics, timelines | entry point, also serves as getTrending |
| getUserLikes | user's liked tweets | userId ← getUserByScreenName rest_id | tweets, cursors | paginated |
| getBookmarks | your bookmarks | count | bookmarked tweets, cursors | paginated, own bookmarks only |
| getNotifications | notifications | count | mentions, likes, follows, retweets | paginated |
| createTweet | post a tweet | text | rest_id | write, CAUTION |
| deleteTweet | delete your tweet | tweet_id | — | write, CAUTION |
| reply | reply to tweet | tweet_id, text | rest_id | write, CAUTION |
| likeTweet | like a tweet | tweet_id ← getHomeTimeline / searchTweets / getTweetDetail | — | write |
| unlikeTweet | unlike a tweet | tweet_id ← getHomeTimeline / searchTweets / getTweetDetail | — | write |
| createBookmark | bookmark tweet | tweet_id ← getHomeTimeline / searchTweets / getTweetDetail | — | write |
| deleteBookmark | remove bookmark | tweet_id ← getHomeTimeline / searchTweets / getTweetDetail | — | write |
| createRetweet | retweet | tweet_id ← getHomeTimeline / searchTweets / getTweetDetail | retweet rest_id | write |
| deleteRetweet | undo retweet | source_tweet_id ← getHomeTimeline / searchTweets / getTweetDetail | — | write |
| followUser | follow user | userId ← getUserByScreenName rest_id | user object | write, CAUTION |
| unfollowUser | unfollow user | userId ← getUserByScreenName rest_id | user object | write, CAUTION |
| blockUser | block user | userId ← getUserByScreenName rest_id | user object | write, CAUTION |
| unblockUser | unblock user | userId ← getUserByScreenName rest_id | user object | write, CAUTION |
| muteUser | mute user | userId ← getUserByScreenName rest_id | user object | write, CAUTION |
| unmuteUser | unmute user | userId ← getUserByScreenName rest_id | user object | write, CAUTION |
| hideReply | hide reply | tweet_id (reply to your tweet) | hidden: true | write, CAUTION |
| unhideReply | unhide reply | tweet_id | hidden: false | write, CAUTION |
| sendDM | send DM | recipientId ← getUserByScreenName rest_id, text | DM event | write, CAUTION, approved contacts |

## Quick Start

```bash
# Get home timeline
openweb x exec getHomeTimeline '{"count": 20}'

# Search tweets
openweb x exec searchTweets '{"rawQuery": "openai", "count": 20, "product": "Latest"}'

# Get user profile
openweb x exec getUserByScreenName '{"screen_name": "openai"}'

# Get tweet detail (also serves as getThread)
openweb x exec getTweetDetail '{"focalTweetId": "1234567890"}'

# Get user's followers (need userId from getUserByScreenName → rest_id)
openweb x exec getUserFollowers '{"userId": "4398626122", "count": 20}'

# Create a tweet
openweb x exec createTweet '{"text": "Hello from OpenWeb!"}'

# Reply to a tweet
openweb x exec reply '{"tweet_id": "1234567890", "text": "Great thread!"}'

# Follow a user
openweb x exec followUser '{"userId": "4398626122"}'

# Send a DM (approved contacts only)
openweb x exec sendDM '{"recipientId": "4398626122", "text": "Hey!"}'

# Get notifications
openweb x exec getNotifications '{"count": 20}'

# Get your bookmarks
openweb x exec getBookmarks '{"count": 20}'

# Get user's liked tweets
openweb x exec getUserLikes '{"userId": "4398626122", "count": 20}'
```

---

## Site Internals

### API Architecture
- **GraphQL** — most operations use `/i/api/graphql/{queryHash}/{OperationName}`
- Persisted queries with hash IDs that **rotate on every Twitter deploy**
- `variables` and `features` sent as JSON-stringified query params (GET) or body (POST mutations)
- Bearer token `AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D...` is a public app token (not user-specific)
- **REST v1.1** — social graph actions (follow, unfollow, block, unblock, mute, unmute) use `/i/api/1.1/` with form-urlencoded body
- **REST v2** — *(deprecated for moderation)* legacy `PUT /i/api/2/tweets/{id}/hidden` no longer exists; requests hang ~45 s. Use the GraphQL `ModerateTweet` / `UnmoderateTweet` path documented below.
- **DM REST** — `sendDM` uses `/i/api/1.1/dm/new2.json` with JSON body

### Adapter Architecture
- **L3 adapter** (`x-graphql`) handles all operations — both GraphQL and REST
- **Adapter shape:** `CustomRunner` — single `run(ctx)` entrypoint. No `init()` (the URL check was trivial) and no `isAuthenticated()` (the prior cookie-probe for `auth_token`/`twid` was dropped because it never validated against the server; runtime auth-primitive resolution covers credential-configured semantics)
- **Dynamic hash resolution**: query hashes extracted at runtime from the main.js webpack bundle (not hardcoded), survives Twitter deploys
- **Request signing**: `x-client-transaction-id` generated via Twitter's own signing function (webpack module 938838, export `jJ`). Required for Followers and SearchTimeline endpoints; applied to all GraphQL requests for consistency
- **REST helper**: `restRequest` + `executeRest` for v1.1/v2 calls — no signing needed, just Bearer + CSRF

### Auth
- **Auth:** browser cookies (auth_token, twid, etc.) — sent via `credentials: 'include'`
- **CSRF:** `ct0` cookie → `x-csrf-token` header — resolved inline by adapter
- **Bearer:** static public app token — hardcoded in adapter (not user-specific)
- **Signing:** `x-client-transaction-id` — per-request, generated by Twitter's webpack signing module (GraphQL only)

### Transport
- **Transport:** `page` — required because Twitter uses TLS fingerprinting
- Node transport gets 403 even with valid cookies
- Adapter runs `page.evaluate(fetch(...))` inside the browser tab

### Known Issues
- Webpack signing module ID (938838) may change on major Twitter refactors — grep for `"x-client-transaction-id"]=await` in main.js to find the new module
- CSRF required on GET requests (not just POST)
- Rate limiting: ~900 requests/15min for most endpoints
- Response schemas are deeply nested (TimelineTimelineItem → tweet_results → result → legacy)
- `sendDM` only works for approved contacts (users who follow you or have open DMs)
- **`deleteDM` was removed from the spec (2026-04-19).** The `DMMessageDeleteMutation` queryId lives in a webpack chunk that's only fetched when the user clicks "Delete for you" inside an open DM thread — not in main.js, not in any chunk loaded by visiting `/messages` or by opening a conversation. Discovery would need to trigger a real delete to intercept the request URL, which is environment-fragile and not worth automating for a single op. Re-add only if a chunk-stable discovery path emerges.
- `getBookmarks` and `getNotifications` only return the authenticated user's data
- `getBookmarks` uses the `Bookmarks` GraphQL operation whose queryId lives in a lazy-loaded webpack chunk (not in main.js); the adapter discovers it by navigating to `/i/bookmarks` and capturing the API request URL on first call
- `getTrending` → use `getExplorePage`; `getThread` → use `getTweetDetail`

### Verify quirk (write ops)
- **Pre-warm requirement:** open `https://x.com/home` in the managed Chrome (port 9222) **before** running `pnpm dev verify x --write --browser`. The site declares `page_plan.entry_url=https://x.com/home` with `warm: true`, but the runtime cascade described below can still leave verify holding a stale handle if no x.com tab exists at start.
- **Original symptom (pre-`acc23ad`):** every write op reported `No browser context available`. Cause: a runtime cascade — `handleLoginRequired() → refreshProfile()` killed and restarted the managed Chrome, but `commands/verify.ts` had pre-acquired a `Browser` handle, so all subsequent ops dispatched against a dead port.
- **Fix (runtime commit `acc23ad`):** verify no longer pre-acquires `deps.browser`; each op calls `ensureBrowser()` to re-read the live port. **Impact:** x went from 0/14 → 8/14 PASS in one shot — `likeTweet`, `unlikeTweet`, `createBookmark`, `deleteBookmark`, `createRetweet`, `deleteRetweet`, `unblockUser`, `unfollowUser` all PASS with a pre-warmed tab.
- **Self-target fixture pitfall (commit `43f8e37`):** the original example `userId 4211243893` was the logged-in account itself (@iamoonkey). Twitter returns 403 (`code 158/147/271 — "you can't follow/block/mute yourself"`). The runtime maps 403 → `needs_login`, then `handleLoginRequired()` opens a system browser and polls for 5 min — verify's per-op 45 s timeout fires first. The destroy variants returned 200 no-op so they appeared to PASS, masking the diagnosis. Resolved by switching the fixture to `2244994945` (@XDevelopers, a stable third-party). Standalone `pnpm dev x exec` now confirms all 6 user-graph ops return 200.
- **Pair `order` field (commit `43f8e37`):** added `order: 1..8` to follow/unfollow/block/unblock/mute/unmute/hide/unhide so each create runs immediately before its destroy. Prevents cross-pair contamination — e.g. without ordering, `blockUser` would auto-unfollow @XDevelopers and a later `unfollowUser` would 200 no-op against an unrelated state.
- **Reply fixture (cross-account, 2026-04-20):** `hideReply`/`unhideReply` use `tweet_id 2046061970021847164` — a reply by `@QGuo219895` (the user's alt account) on `@iamoonkey/2045749343437619246`. Cross-account is mandatory: Twitter blocks moderating own replies on own thread, returning DRIFT against the chained `${prev.reply...}` fixture. Both ops migrated from REST `PUT /i/api/2/tweets/{id}/hidden` (now removed — hangs 45 s and trips `needs_login` cascade) to GraphQL `ModerateTweet` / `UnmoderateTweet` with `variables: { tweetId }`. Response is `{tweet_moderate_put|tweet_unmoderate_put: "Done"}`, NOT `{hidden: boolean}` — schema relaxed to `type:object`. `unhideReply` chains via `order: 19` after `hideReply`'s `order: 18`. Commits `b734164` (transport migration) + `986b916` (cross-account fixture + schema).
- **Aggregate verify still flaky:** even with correct fixtures, the verify framework's per-op cascade (kill+restart Chrome on the first 401/403/timeout, retry within 45 s budget) leaves Chrome in inconsistent state for downstream ops — port-bound errors, page closed, queryId cache lost. Symptom: 2/8 PASS in `verify --write` despite all 6 passing in standalone `exec`. Root cause is verify-framework, not site fixtures.
- See `doc/todo/write-verify/handoff.md` §3.3 for full hypothesis list and §4 for cross-cutting framework gaps.
