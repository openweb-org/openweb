# Reddit

## Overview
Reddit — social news and discussion platform. Dual-server architecture.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getSubreddit | hot posts from a subreddit | GET /r/{subreddit}/hot.json | `after` cursor pagination |
| vote | vote on post/comment | POST /api/vote | write op, unverified |
| getMe | authenticated user profile | GET /api/v1/me | uses `oauth.reddit.com` server |

## API Architecture
- **Two servers** with different auth:
  - `www.reddit.com` — cookie_session (getSubreddit, vote)
  - `oauth.reddit.com` — exchange_chain with OAuth bearer (getMe)
- Reddit's `.json` suffix on paths returns JSON instead of HTML
- Response structure: `{data: {children: [...], after: "t3_..."}}`

## Auth
- **www.reddit.com**: `cookie_session`
- **oauth.reddit.com**: `exchange_chain` — 2-step process:
  1. GET `/svc/shreddit/token` → extract `csrf_token` from cookie
  2. POST `/svc/shreddit/token` with csrf → extract bearer token
  - Injected as `Authorization: Bearer <token>`

## Transport
- `node` — all endpoints use direct HTTP

## Known Issues
- `vote` operation unverified
