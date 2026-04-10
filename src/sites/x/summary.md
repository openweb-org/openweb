# X (Twitter) — 16 new write/read ops

## What was done
Added 13 write ops + 3 read ops to the X site package: `createTweet`, `deleteTweet`, `reply`, `followUser`, `unfollowUser`, `blockUser`, `unblockUser`, `muteUser`, `unmuteUser`, `hideReply`, `unhideReply`, `sendDM`, `deleteDM`, `getNotifications`, `getUserLikes`, `getBookmarks`. Total ops: 14 → 30.

## Approach
- All new ops route through the `x-graphql` adapter — the single adapter handles both GraphQL and REST
- **GraphQL mutations** (createTweet, deleteTweet, reply, deleteDM): use `executeGraphqlPost` with Twitter's `CreateTweet`, `DeleteTweet`, `DMMessageDeleteMutation` operations
- **REST v1.1** (follow, unfollow, block, unblock, mute, unmute): use `executeRest` with `/i/api/1.1/` form-urlencoded endpoints
- **REST v2** (hideReply, unhideReply): use `executeRest` with `/i/api/2/tweets/{id}/hidden` JSON PUT
- **REST DM** (sendDM): use `executeRest` with `/i/api/1.1/dm/new2.json` JSON POST
- **GraphQL queries** (getNotifications, getUserLikes, getBookmarks): use `executeGraphqlGet` with `Notifications`, `Likes`, `Bookmarks` operations
- Added generic `restRequest` + `executeRest` helpers for REST endpoints (Bearer + CSRF, no signing)
- All write ops have `permission: write`, `safety: caution`; read ops have `permission: read`
- New write ops use `requestBody` with `application/json` content type

## Files changed
- `openapi.yaml` — 16 new paths/operations
- `adapters/x-graphql.ts` — added `restRequest`/`executeRest` helpers, 7 new OP_NAME entries, 16 new operation handlers
- `examples/` — 16 new example JSON files (13 `unsafe_mutation`, 3 `safe_read`)
- `DOC.md` — new workflows (compose, social graph, moderation, DMs, notifications), expanded ops table, quick start

## Pitfalls
- Twitter has three API surfaces: GraphQL (with rotating query hashes), REST v1.1 (form-urlencoded), REST v2 (JSON) — the adapter handles all three
- Social graph ops (follow/block/mute) use REST v1.1 despite everything else being GraphQL — these endpoints are stable and don't require query hash resolution
- `reply` uses the same `CreateTweet` GraphQL operation as `createTweet`, with an additional `reply.in_reply_to_tweet_id` variable
- `hideReply`/`unhideReply` use PUT method (not POST) on the v2 API
- `sendDM` uses `recipient_ids` field (the target user ID as a string) — only works for users who follow you or have open DMs
- `deleteDM` uses `DMMessageDeleteMutation` GraphQL operation — the operation name in Twitter's bundle may change
- REST endpoints don't need `x-client-transaction-id` signing — only GraphQL endpoints do
- `getBookmarks` uses dynamic GraphQL operation discovery because the operation name varies across Twitter deploys; may return HTTP 422 if the account lacks X Premium or if Twitter changes required variables
- `getTrending` is covered by `getExplorePage`; `getThread` is covered by `getTweetDetail`

## Verification
- `pnpm build`: compiles without errors
- `pnpm dev verify x --write --browser`: read ops pass; write ops gated behind auth/permission layer
