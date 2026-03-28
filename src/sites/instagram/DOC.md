# Instagram

## Overview
Social media platform (Meta). Photo/video sharing, stories, reels, explore feed.

## Quick Start

```bash
# Search for users by keyword
openweb instagram exec searchUsers '{"query":"nature"}'

# Get a user's profile info
openweb instagram exec getUserProfile '{"username":"natgeo","x-ig-app-id":"936619743392459","x-requested-with":"XMLHttpRequest"}'

# Get a user's recent posts (need user_id from profile)
openweb instagram exec getUserPosts '{"user_id":"787132","x-ig-app-id":"936619743392459","x-requested-with":"XMLHttpRequest"}'

# Get media info by media ID (from posts)
openweb instagram exec getMediaInfo '{"media_id":"3854796740277763042","x-ig-app-id":"936619743392459","x-requested-with":"XMLHttpRequest"}'

# Search content (posts/reels) by keyword
openweb instagram exec searchContent '{"query":"nature","x-ig-app-id":"936619743392459","x-requested-with":"XMLHttpRequest"}'

# Get explore grid
openweb instagram exec getExploreGrid '{"x-ig-app-id":"936619743392459","x-requested-with":"XMLHttpRequest"}'
```

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchUsers | search users, hashtags, places | GET /web/search/topsearch/ | No extra headers needed |
| getUserProfile | view user profile | GET /api/v1/users/web_profile_info/ | Returns bio, follower count, post count |
| getUserPosts | list user's posts | GET /api/v1/feed/user/{user_id}/ | Paginated via max_id |
| getMediaInfo | view post/reel detail | GET /api/v1/media/{media_id}/info/ | Full media metadata |
| getMediaComments | view post comments | GET /api/v1/media/{media_id}/comments/ | Paginated via min_id |
| searchContent | search posts/reels by keyword | GET /api/v1/fbsearch/web/top_serp/ | Returns media grid |
| getExploreGrid | browse explore feed | GET /api/v1/discover/web/explore_grid/ | Paginated via max_id |
| getReelsTray | view stories tray | GET /api/v1/feed/reels_tray/ | Logged-in user's stories |
| getTimeline | view home feed | POST /api/v1/feed/timeline/ | Logged-in user's timeline |

## API Architecture
- REST API v1 at `/api/v1/` — main data endpoints (JSON responses)
- `/web/search/topsearch/` — lightweight search (no extra headers required)
- GraphQL at `/api/graphql/` — uses `doc_id` persisted queries (not exposed, too dynamic)
- All v1 endpoints require `x-ig-app-id: 936619743392459` and `x-requested-with: XMLHttpRequest` headers

## Auth
- **Type:** cookie_session
- **CSRF:** cookie_to_header (cookie: `csrftoken`, header: `x-csrftoken`)
- Session cookies: `sessionid`, `csrftoken`, `ds_user_id`, `c_user`, `xs`
- Additional required headers for v1 API: `x-ig-app-id` (static), `x-requested-with` (static)
- `x-ig-www-claim` from sessionStorage is sent by the browser but not strictly required for most endpoints

## Transport
- **page** — required because Instagram needs browser session cookies and the v1 API validates origin context
- `searchUsers` works with just cookies (no extra headers), but other v1 endpoints need the app ID header

## Known Issues
- Heavy bot detection (Meta custom) — node transport fails, page transport required
- GraphQL operations use dynamic `doc_id` values — not practical to expose as static operations
- `x-ig-app-id` (`936619743392459`) is the web app's static ID but may change in future deployments
- Rate limiting is aggressive — keep request frequency low
- Media IDs are large integers (>18 digits) — must be passed as strings
