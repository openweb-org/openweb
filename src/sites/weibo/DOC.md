# Weibo

## Overview
Chinese microblogging platform (China's Twitter equivalent). Social media archetype, Chinese web.

## Quick Start

```bash
# Get trending hot search topics
openweb weibo exec getHotSearch '{}'

# Get hot timeline feed
openweb weibo exec getHotTimeline '{"group_id": 102803, "containerid": 102803, "count": 10}'

# Get user profile
openweb weibo exec getUserProfile '{"uid": 1699432410}'

# Get user's posts (page 1)
openweb weibo exec getUserPosts '{"uid": 1699432410, "page": 1}'

# Get a specific post
openweb weibo exec getPostDetail '{"id": "5281459511232930"}'

# Get search suggestions
openweb weibo exec getSearchSuggestions '{"q": "科技"}'
```

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getHotSearch | Trending topics | GET /ajax/side/hotSearch | Returns realtime[] with 50 trending items + hotgovs[] |
| getHotBand | Hot band trending | GET /ajax/statuses/hot_band | Categorized trending with band_list[] |
| getHotTimeline | Hot timeline feed | GET /ajax/feed/hottimeline | Paginated via max_id, group_id=102803 |
| getUserProfile | User profile | GET /ajax/profile/info | Basic info: name, followers, verified status |
| getUserDetail | User extended detail | GET /ajax/profile/detail | Birthday, created_at, description, sunshine_credit |
| getUserPosts | User's posts | GET /ajax/statuses/mymblog | Paginated by page number, filterable by feature type |
| getPostDetail | Post detail | GET /ajax/statuses/show | Full post with user, counts, media IDs |
| getSearchSuggestions | Search suggestions | GET /ajax/side/search | Related hot queries for a keyword |

## API Architecture
- REST JSON APIs on `weibo.com/ajax/*` namespace
- All API endpoints require authentication (return 403 without cookies)
- Responses wrap data in `{ok: 1, data: {...}}` pattern (getHotTimeline is an exception with root-level `statuses`)
- User IDs are numeric integers (e.g., 1699432410 = Xinhua News)

## Auth
- **Type:** cookie_session
- **CSRF:** cookie_to_header (`XSRF-TOKEN` cookie -> `x-xsrf-token` header)
- **Key cookies:** SUB, SUBP, ALF, XSRF-TOKEN, WBPSESS
- XSRF-TOKEN rotates — the browser handles this automatically via page transport

## Transport
- **page** — all Weibo APIs require browser cookie context
- Node transport returns 403 on all /ajax/* endpoints
- The browser page URL is weibo.com (any page)

## Known Issues
- **Login required:** All /ajax/* APIs return 403 without valid session cookies. Must be logged in.
- **XSRF token rotation:** The XSRF-TOKEN cookie rotates. Page transport handles this automatically.
- **Rate limiting:** Weibo is aggressive about rate limiting. Avoid rapid sequential requests.
- **Post IDs are ephemeral:** Old post IDs may return "该微博不存在" (post doesn't exist) if deleted.
- **s.weibo.com cross-origin:** Search pages live on s.weibo.com; APIs there need JSONP or direct node access. The main /ajax/* APIs on weibo.com cover all core intents.
- **Search not available as API:** Weibo's full text search (s.weibo.com/weibo?q=) returns HTML, not JSON. Use getSearchSuggestions for keyword-based discovery; getHotSearch for trending.
