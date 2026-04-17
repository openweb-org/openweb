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
3. `deleteDM(messageId)` — delete a sent message

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
| deleteDM | delete DM | messageId | — | write, CAUTION |

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
- **REST v2** — moderation (hideReply/unhideReply) uses `/i/api/2/` with JSON body and PUT method
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
- `deleteDM` uses GraphQL `DMMessageDeleteMutation` — operation name may change
- `getBookmarks` and `getNotifications` only return the authenticated user's data
- `getBookmarks` uses the `Bookmarks` GraphQL operation whose queryId lives in a lazy-loaded webpack chunk (not in main.js); the adapter discovers it by navigating to `/i/bookmarks` and capturing the API request URL on first call
- `getTrending` → use `getExplorePage`; `getThread` → use `getTweetDetail`
