# X (Twitter)

## Overview
Social media and microblogging platform. Archetype: Social Media. GraphQL API with persisted query hashes, L3 adapter for dynamic hash resolution and request signing. REST v1.1/v2 endpoints for social graph and moderation actions.

## Workflows

### Browse timeline and interact
1. `getHomeTimeline` → tweets → `tweet_id`
2. `likeTweet(tweet_id)` / `createBookmark(tweet_id)` / `createRetweet(tweet_id)`

### Compose and manage tweets
1. `createTweet(text)` → `rest_id` (new tweet_id)
2. `reply(tweet_id, text)` → reply to a tweet → `rest_id`
3. `deleteTweet(tweet_id)` → delete your own tweet (tweet_id from createTweet `rest_id` or getHomeTimeline)

### Find and read a user's profile
1. `getUserByScreenName(screen_name)` → `rest_id` (userId), `name`, `followers_count`
2. `getUserTweets(userId)` → user's tweets → `tweet_id`
3. `getUserLikes(userId)` → user's liked tweets → `tweet_id`
4. `getUserFollowers(userId)` / `getUserFollowing(userId)` → follower/following `rest_id` list

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
1. `getTweetDetail(focalTweetId)` → reply entries → reply `tweet_id`
2. `hideReply(tweet_id)` / `unhideReply(tweet_id)` — hide/show replies on your tweets

### Direct messages
1. `getUserByScreenName(screen_name)` → `rest_id` (recipientId)
2. `sendDM(recipientId, text)` → DM event with `messageId` — approved contacts only
3. `deleteDM(messageId)` — delete a sent message (messageId from sendDM response)

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
| deleteTweet | delete your tweet | tweet_id ← createTweet rest_id / getHomeTimeline | — | write, CAUTION |
| reply | reply to tweet | tweet_id ← getHomeTimeline / getTweetDetail, text | rest_id | write, CAUTION |
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
| hideReply | hide reply | tweet_id ← getTweetDetail reply entries | hidden: true | write, CAUTION |
| unhideReply | unhide reply | tweet_id ← getTweetDetail reply entries | hidden: false | write, CAUTION |
| sendDM | send DM | recipientId ← getUserByScreenName rest_id, text | messageId, DM event | write, CAUTION, approved contacts |
| deleteDM | delete DM | messageId ← sendDM | — | write, CAUTION |

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
