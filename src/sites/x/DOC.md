# X (Twitter)

## Overview
Social media and microblogging platform. Archetype: Social Media. GraphQL API with persisted query hashes.

## Workflows

### Browse timeline and interact
1. `getHomeTimeline` → tweets with tweet_id
2. `likeTweet(tweet_id)` / `createBookmark(tweet_id)` / `createRetweet(tweet_id)`

### Find and read a user's profile
1. `getUserByScreenName(screen_name)` → `rest_id` (userId), bio, follower counts
2. `getUserTweets(userId)` → user's tweets
3. `getUserFollowers(userId)` / `getUserFollowing(userId)` → follower/following lists

### Search tweets
1. `searchTweets(rawQuery)` → tweet results with cursor pagination
2. `searchTypeahead(q)` → autocomplete suggestions (users, topics)

### Get tweet with replies
1. `getTweetDetail(focalTweetId)` → full tweet thread with replies

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getHomeTimeline | home feed | count | tweets, cursors | entry point, paginated |
| getTweetDetail | tweet + replies | focalTweetId | tweet thread, reply entries | |
| getUserByScreenName | user profile | screen_name | rest_id, name, bio, followers_count | entry point |
| searchTweets | search posts | rawQuery, product (Top/Latest) | tweet results, cursors | paginated |
| getUserTweets | user's tweets | userId ← getUserByScreenName rest_id | tweets, cursors | paginated |
| getUserFollowers | followers list | userId ← getUserByScreenName rest_id | user profiles, cursors | paginated |
| getUserFollowing | following list | userId ← getUserByScreenName rest_id | user profiles, cursors | paginated |
| getExplorePage | trending/explore | — | trending topics, timelines | entry point |
| searchTypeahead | autocomplete | q | users, topics | REST endpoint on api.x.com |
| likeTweet | like a tweet | tweet_id | — | write, SAFE |
| unlikeTweet | unlike a tweet | tweet_id | — | write, SAFE |
| createBookmark | bookmark tweet | tweet_id | — | write, SAFE |
| deleteBookmark | remove bookmark | tweet_id | — | write, SAFE |
| createRetweet | retweet | tweet_id | retweet rest_id | write, SAFE |
| deleteRetweet | undo retweet | source_tweet_id | — | write, SAFE |

## Quick Start

```bash
# Get home timeline
openweb x exec getHomeTimeline '{"count": 20}'

# Search tweets
openweb x exec searchTweets '{"rawQuery": "openai", "count": 20, "product": "Latest"}'

# Get user profile
openweb x exec getUserByScreenName '{"screen_name": "openai"}'

# Get tweet detail
openweb x exec getTweetDetail '{"focalTweetId": "1234567890"}'

# Get user's followers (need userId from getUserByScreenName → rest_id)
openweb x exec getUserFollowers '{"userId": "4398626122", "count": 20}'
```

---

## Site Internals

## API Architecture
- **GraphQL** — all major operations use `/i/api/graphql/{queryHash}/{OperationName}`
- Persisted queries with hash IDs that change on Twitter deploys
- `variables` and `features` sent as JSON-stringified query params (GET) or body (POST mutations)
- One REST endpoint on `api.x.com`: search typeahead
- Bearer token `AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D...` is a public app token (not user-specific)

## Auth
- **Auth:** `cookie_session` — browser cookies (auth_token, twid, etc.)
- **CSRF:** `cookie_to_header` — `ct0` cookie → `x-csrf-token` header
- **CSRF scope:** ALL methods including GET (unusual — most sites only require CSRF on POST)
- Cookies extracted from browser automatically by page transport

## Transport
- **Transport:** `page` — required because Twitter uses TLS fingerprinting
- Node transport gets 403 even with valid cookies
- Page transport executes fetch() inside the browser tab, bypassing TLS checks

## Known Issues
- GraphQL query hash IDs rotate on Twitter deploys — operations may need hash updates
- CSRF required on GET requests (not just POST) — scope includes all methods
- Rate limiting: ~900 requests/15min for most endpoints
- Response schemas are deeply nested (TimelineTimelineItem → tweet_results → result → legacy)
- `features` param is a large JSON blob of feature flags — browser sends automatically
