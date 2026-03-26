# Reddit

## Overview
Reddit — social news and discussion platform. Dual-server architecture.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getSubreddit | hot posts from a subreddit | GET /r/{subreddit}/hot.json | `after` cursor pagination |
| getPost | post detail with comment tree | GET /r/{subreddit}/comments/{article}.json | returns array of 2 listings (post + comments) |
| searchPosts | search posts across Reddit | GET /search.json | sort by relevance/hot/top/new/comments, time filter |
| getSubredditAbout | subreddit metadata and rules | GET /r/{subreddit}/about.json | subscribers, description, active users |
| getUserProfile | user's public profile | GET /user/{username}/about.json | karma, created date, gold status |
| getUserHistory | user's recent posts and comments | GET /user/{username}.json | `after` cursor pagination, sort/time filters |
| getPopular | popular/trending posts across Reddit | GET /r/popular/hot.json | `after` cursor pagination |
| vote | vote on post/comment | POST /api/vote | ✅ SAFE (reversible), unverified |
| savePost | save (bookmark) a post or comment | POST /api/save | ✅ SAFE (reversible), unverified |
| getMe | authenticated user profile | GET /api/v1/me | uses `oauth.reddit.com` server |

## API Architecture
- **Two servers** with different auth:
  - `www.reddit.com` — cookie_session (most operations)
  - `oauth.reddit.com` — exchange_chain with OAuth bearer (getMe)
- Reddit's `.json` suffix on paths returns JSON instead of HTML
- Response structure: `{data: {children: [...], after: "t3_..."}}`
- Post comments endpoint returns an array of two listings: [post, comments]

## Auth
- **www.reddit.com**: `cookie_session`
- **oauth.reddit.com**: `exchange_chain` — 2-step process:
  1. GET `/svc/shreddit/token` → extract `csrf_token` from cookie
  2. POST `/svc/shreddit/token` with csrf → extract bearer token
  - Injected as `Authorization: Bearer <token>`

## Transport
- `node` — all endpoints use direct HTTP

## Known Issues
- `vote` and `savePost` operations unverified (write ops)
- New read operations (getPost, searchPosts, etc.) added manually — not yet verified via `openweb verify`
- `openweb compile` hangs on Reddit due to large HAR capture (38MB) — the LLM pipeline in the analyzer likely times out or processes too many samples. Future captures should be more targeted.
