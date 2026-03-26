# X (Twitter)

## Overview
X (Twitter) — social media platform. GraphQL API (v2) + REST API (v1.1). Page transport with multi-layer auth.

## Operations
| Operation | Intent | Method | Path | Notes |
|-----------|--------|--------|------|-------|
| listFollowing | accounts user follows | GET | /1.1/friends/list.json | cursor pagination, REST v1.1 |
| listFollowers | user's followers | GET | /1.1/followers/list.json | cursor pagination, REST v1.1 |
| getHomeTimeline | view home feed | GET | /graphql/.../HomeTimeline | GraphQL, returns tweet entries |
| searchTweets | search tweets by keyword | GET | /graphql/.../SearchTimeline | GraphQL, rawQuery + product filter |
| getUserTweets | browse user's tweets | GET | /graphql/.../UserTweets | GraphQL, requires userId |
| getTweetDetail | tweet with reply thread | GET | /graphql/.../TweetDetail | GraphQL, focalTweetId + replies |
| getTweetById | get single tweet by ID | GET | /graphql/.../TweetResultByRestId | GraphQL, single tweet |
| getExplorePage | trending topics/explore | GET | /graphql/.../ExplorePage | GraphQL, cursor pagination |
| getUserProfile | user profile by handle | GET | /graphql/.../UserByScreenName | GraphQL, screen_name param |
| getBookmarks | saved/bookmarked tweets | GET | /graphql/.../Bookmarks | GraphQL, authenticated user only |
| likeTweet | like a tweet | POST | /graphql/.../FavoriteTweet | write, tweet_id in body |
| unlikeTweet | unlike a tweet | POST | /graphql/.../UnfavoriteTweet | write, tweet_id in body |
| retweet | retweet a tweet | POST | /graphql/.../CreateRetweet | write, tweet_id in body |
| undoRetweet | undo a retweet | POST | /graphql/.../DeleteRetweet | write, source_tweet_id in body |
| bookmarkTweet | bookmark a tweet | POST | /graphql/.../CreateBookmark | write, tweet_id in body |
| unbookmarkTweet | remove bookmark | POST | /graphql/.../DeleteBookmark | write, tweet_id in body |

## API Architecture
- **GraphQL** at `x.com/i/api/graphql/<hash>/<OperationName>` for most operations
- **REST v1.1** at `x.com/i/api/1.1/` for legacy endpoints (friends/followers)
- GraphQL read ops use GET with `variables` and `features` as URL-encoded JSON query params
- GraphQL write ops use POST with `{"variables": {...}, "queryId": "..."}` JSON body
- GraphQL hashes are semi-stable but can rotate on X deployments
- `features` parameter is a large JSON object of feature flags — required for most GraphQL ops

## Auth
- `cookie_session` — browser session cookies required
- **CSRF**: `cookie_to_header` — reads `ct0` cookie, sends as `x-csrf-token` header on **all methods** (including GET)
- **Static bearer token**: fixed `Authorization: Bearer AAAA...` header (X web app constant, same for all users)
- Additional headers: `x-twitter-auth-type: OAuth2Session`, `x-twitter-active-user: yes`

## Transport
- `page` — requires X/Twitter page loaded in browser tab
- All API calls go through `fetch()` in browser context to inherit cookies

## Write Operations Safety
| Operation | Safety | Notes |
|-----------|--------|-------|
| likeTweet / unlikeTweet | SAFE | reversible |
| retweet / undoRetweet | SAFE | reversible |
| bookmarkTweet / unbookmarkTweet | SAFE | reversible |

## Known Issues
- CSRF token required on GET requests (unusual — most sites only require on mutating methods)
- GraphQL hashes may rotate on X deployments — if operations return 404, re-capture to get updated hashes
- `searchTweets` may intermittently return 404 — suspected hash rotation or rate limiting
- Response schemas are deeply nested GraphQL structures; `required` constraints removed to avoid drift
- `features` parameter values are X-specific and may change over time
