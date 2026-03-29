# Reddit

## Overview
Social media platform — link aggregation, discussion, communities (subreddits). Social Media archetype.

## Quick Start

```bash
# Search posts by keyword
openweb reddit exec searchPosts '{"q": "typescript"}'

# Get subreddit posts
openweb reddit exec getSubredditPosts '{"subreddit": "programming"}'

# Get popular posts
openweb reddit exec getPopularPosts '{}'

# Get post with comments
openweb reddit exec getPostComments '{"subreddit": "programming", "post_id": "1s5ja3a"}'

# Get user profile
openweb reddit exec getUserProfile '{"username": "spez"}'

# Get user's recent posts/comments
openweb reddit exec getUserPosts '{"username": "spez"}'

# Get subreddit metadata
openweb reddit exec getSubredditAbout '{"subreddit": "programming"}'
```

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchPosts | Search posts by keyword | GET /search.json | Sort, time filter, type filter (posts/subreddits/users) |
| getSubredditPosts | Get subreddit feed | GET /r/{subreddit}.json | Sort (hot/new/top/rising), pagination via after cursor |
| getPopularPosts | Get popular posts | GET /r/popular.json | Cross-subreddit popular feed |
| getPostComments | Get post with comments | GET /r/{subreddit}/comments/{post_id}.json | Returns [post, comments] array |
| getUserProfile | Get user profile | GET /user/{username}/about.json | Karma, created date, verified status |
| getUserPosts | Get user's posts/comments | GET /user/{username}.json | Sort by new/hot/top, paginated |
| getSubredditAbout | Get subreddit metadata | GET /r/{subreddit}/about.json | Subscribers, description, active users |
| vote | Vote on post/comment | POST /api/vote | Requires auth. Reversible (dir: 1/0/-1) |
| savePost | Bookmark a post/comment | POST /api/save | Requires auth |
| getMe | Authenticated user profile | GET /api/v1/me | Requires auth. Uses oauth.reddit.com |

## API Architecture
- Public read API via `www.reddit.com` — append `.json` to any Reddit URL for JSON
- Authenticated ops use `oauth.reddit.com` (getMe) or www.reddit.com with cookies (vote, savePost)
- Response structure: `{data: {children: [...], after: "t3_..."}}`
- Post comments endpoint returns an array of two Listings: [0] = post data, [1] = comment tree
- Pagination via `after` cursor parameter (fullname like `t3_1s5ja3a`)

## Auth
No auth required for public read operations (8 ops). The `.json` API works without authentication.

Write operations (`vote`, `savePost`) and `getMe` require authentication. Without auth:
- `getMe` returns features config instead of user profile
- `vote` and `savePost` need `write` permission + authenticated session
- Auth flow (not configured in this package): cookie CSRF → POST shreddit/token → bearer JWT → oauth.reddit.com

## Transport
Node transport — all public read operations work via direct HTTP fetch.

## Known Issues
- `vote` and `savePost` require write permission + authenticated session (unverified)
- `getMe` returns partial data without auth (features only, no user profile)
- Rate limiting may apply for high-frequency requests
- Some subreddits may be private or quarantined (returns 403/451)
- Response size can be large (100KB+ for feeds, 200KB+ for comment threads)
