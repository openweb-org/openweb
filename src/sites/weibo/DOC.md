# Weibo

## Overview
Chinese microblogging social media platform — China's equivalent of Twitter/X. Trending topics, post search, post detail with comments, user profiles and timelines, plus write operations (like, repost, follow, bookmark). All operations use Weibo's internal AJAX APIs (`/ajax/*`) accessed via page transport with cookie-based authentication.

## Quick Start

```bash
# Get trending topics
openweb weibo exec getHotSearch '{}'

# Get home feed
openweb weibo exec getFriendsFeed '{"list_id": "my_follow_all", "count": 25}'

# Get a user's profile
openweb weibo exec getUserProfile '{"uid": 1918530507}'

# Get a specific post
openweb weibo exec getPost '{"id": "Qyj0ifs0m"}'

# Get a user's posts
openweb weibo exec getUserStatuses '{"uid": 1706699904, "page": 1}'

# Get hot/trending feed
openweb weibo exec getHotFeed '{"group_id": 102803, "containerid": 102803, "count": 10, "extparam": "discover|new_feed"}'
```

## Operations

| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getFriendsFeed | home feed (followed users) | GET /ajax/feed/friendstimeline | posts with text, images, engagement counts |
| getHotFeed | hot/trending feed | GET /ajax/feed/hottimeline | requires extparam=discover\|new_feed |
| getUnreadFeed | unread posts | GET /ajax/feed/unreadfriendstimeline | |
| listFeedGroups | feed groups | GET /ajax/feed/allGroups | custom timeline groups |
| getHotSearch | trending topics | GET /ajax/side/hotSearch | top 50 with rank, heat, labels (新/热/沸/爆) |
| getSearchBand | search band | GET /ajax/side/searchBand | trending topic bar |
| searchSuggest | search suggestions | GET /ajax/side/search | hot queries; pass `q` for keyword results |
| getUserProfile | user profile | GET /ajax/profile/info | screen name, avatar, bio, followers, verification |
| getUserDetail | user detail | GET /ajax/profile/detail | birthday, gender, location, creation date |
| getUserStatuses | user's posts | GET /ajax/statuses/mymblog | page-based pagination, filter by type |
| getPost | post detail | GET /ajax/statuses/show | full text, images, engagement counts, author |
| getLongtext | long text content | GET /ajax/statuses/longtext | for truncated posts |
| listComments | post comments | GET /ajax/statuses/buildComments | paginated via max_id, sort by hot or time |
| listReposts | post reposts | GET /ajax/statuses/repostTimeline | repost text, author |
| getUnreadMessages | unread count | GET /ajax/message/unreadHint | notification counts |
| getConfig | site config | GET /ajax/config/get_config | logged-in user info |
| listSidebarCards | sidebar cards | GET /ajax/side/cards | recommendation cards |
| likePost | like a post | POST /ajax/statuses/setLike | SAFE: reversible via cancelLike |
| repost | repost/retweet | POST /ajax/statuses/repost | SAFE: reversible via destroy (adapter) |
| followUser | follow a user | POST /ajax/friendships/create | SAFE: reversible via unfollow (adapter) |
| bookmarkPost | bookmark a post | POST /ajax/statuses/createFavorites | SAFE: reversible via destoryFavorites (adapter) |

## API Architecture

- **Primary host**: `weibo.com` — all AJAX endpoints under `/ajax/` path
- **Response format**: JSON with `{ok: 1, data: {...}}` or direct object
- **SPA**: home feed and hot page load data via AJAX, not SSR
- **Post IDs**: alphanumeric strings (e.g., `Qyj0ifs0m`)
- **User IDs**: numeric integers
- **Pagination**: cursor-based (`since_id`/`max_id`) for feeds; page-based for user timeline

## Auth

- Type: `cookie_session` — `SUB` cookie for session
- CSRF: `cookie_to_header` — XSRF-TOKEN cookie -> x-xsrf-token header
- Login required for all operations
- XSRF tokens rotate on every response — runtime uses fresh tokens from browser context

## Transport

- `page` — node transport blocked by anti-bot (returns 403)
- Requires managed browser with open weibo.com tab
- All API calls execute via `page.evaluate(fetch(...))` in browser context

## Adapter

The `weibo-web` adapter handles operations that need special routing:
- **Write operations** (repost, followUser, bookmarkPost): CSRF token extraction + form/JSON body encoding
- Other read operations and likePost work via the default page transport with server-level CSRF config

## Known Issues

- **Login required** — all operations need an active Weibo session (SUB cookie)
- **Anti-bot detection** — node HTTP always returns 403; must use page transport
- **Rate limiting** — aggressive rate limits on search and feed APIs; may return 418 or empty data
- **CSRF token rotation** — XSRF-TOKEN rotates on every response; adapter and runtime handle this automatically
- **Search scope** — `/ajax/side/search` returns sidebar-style results; full search at `s.weibo.com/weibo?q=` returns server-rendered HTML (not covered)
- **Long text truncation** — posts over ~140 chars truncated unless `isGetLongText=true` set in getPost
- **API typos** — Weibo's API has known typos: `destory` instead of `destroy` in `/ajax/friendships/destory` and `/ajax/statuses/destoryFavorites`
