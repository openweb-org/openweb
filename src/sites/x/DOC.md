# X (Twitter)

## Overview
Social media platform (x.com). GraphQL-heavy API with persisted query hashes, bearer token auth, and CSRF on all HTTP methods.

## Quick Start

```bash
# Search tweets
openweb x exec searchTweets '{"variables":"%7B%22rawQuery%22%3A%22your+search%22%2C%22count%22%3A20%2C%22querySource%22%3A%22typed_query%22%2C%22product%22%3A%22Top%22%2C%22withGrokTranslatedBio%22%3Afalse%7D"}'

# Get user profile
openweb x exec getUserProfile '{}'

# Get user tweets (userId 44196397 = @elonmusk)
openweb x exec getUserTweets '{}'

# Get tweet detail by focal tweet ID
openweb x exec getTweetDetail '{}'

# Get explore/trending page
openweb x exec getExplorePage '{}'

# Get home timeline
openweb x exec getHomeTimeline '{}'
```

Note: Query parameters (`variables`, `features`, `fieldToggles`) must be URL-encoded JSON strings. Defaults are pre-encoded in the spec.

## Operations

| Operation | Intent | Endpoint | Notes |
|-----------|--------|----------|-------|
| searchTweets | Search tweets by keyword | GET /i/api/graphql/.../SearchTimeline | May return 404 intermittently (rate-limited) |
| getUserProfile | Get user profile by screen name | GET /i/api/graphql/.../UserByScreenName | Returns full profile, followers, bio |
| getUserTweets | Get tweets by a user | GET /i/api/graphql/.../UserTweets | Requires userId (numeric) |
| getTweetDetail | Get tweet with conversation thread | GET /i/api/graphql/.../TweetDetail | Requires focalTweetId |
| getTweetById | Get single tweet by ID | GET /i/api/graphql/.../TweetResultByRestId | Requires tweetId |
| getExplorePage | Get explore/trending content | GET /i/api/graphql/.../ExplorePage | No required params |
| getHomeTimeline | Get authenticated home feed | GET /i/api/graphql/.../HomeTimeline | Returns followed accounts' tweets |

## API Architecture

- **GraphQL with persisted query hashes**: All API calls go to `/i/api/graphql/{hash}/{OperationName}` via GET
- **Query hashes rotate on deploy**: Hashes are baked into X's JavaScript bundles and change when code deploys. Re-capture needed when hashes expire (404 responses).
- **Parameters are URL-encoded JSON**: `variables`, `features`, and `fieldToggles` are query params whose values are URL-encoded JSON objects
- **Heavy feature flags**: The `features` param contains 30+ boolean flags that control response shape. Must match current expectations.

## Auth

- **Type**: `cookie_session` + bearer token
- **Bearer token**: Fixed app-level token `AAAAAAAAAAAAAAAAAAAAANRILgA...` (not user-specific, embedded in JS bundle)
- **CSRF**: `cookie_to_header` — `ct0` cookie value sent as `x-csrf-token` header
- **CSRF scope**: ALL methods including GET (unusual — most sites only CSRF on mutations)
- **Additional headers**: `x-twitter-auth-type: OAuth2Session`, `x-twitter-active-user: yes`, `x-twitter-client-language: en`

## Transport

- **page** transport required
- X uses TLS fingerprinting — node transport returns 400/403
- Requires an open x.com tab in the managed browser
- `credentials: 'include'` sends cookies automatically via browser context

## Known Issues

- **SearchTimeline intermittent 404**: The search endpoint appears to be more aggressively protected than other endpoints. May return 404 even with correct hashes and auth.
- **Query hash rotation**: Persisted query hashes rotate on X code deploys (frequency varies). When operations start returning 404, re-capture is needed to get fresh hashes.
- **URL encoding required**: The `buildTargetUrl` function uses minimal encoding, so JSON query param defaults must be pre-URL-encoded in the spec.
- **Feature flag drift**: The `features` JSON object changes as X adds/removes feature flags. Stale feature flags may cause 400 errors.
- **Rate limiting**: Heavy API usage from the same session may trigger rate limits (429) or temporary blocks.
