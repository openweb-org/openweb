# Weibo

## Overview

Chinese microblogging platform (China's Twitter/X). Trending topics, post search, post detail with comments, user profiles and timelines. All operations use Weibo's internal AJAX APIs (`/ajax/*`) accessed via page transport with cookie-based authentication.

## Operations

| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getHotSearch | hot search ranking (top 50) | GET /ajax/side/hotSearch | realtime trending with heat scores, labels (新/热/沸/爆) |
| getSearchBand | trending sidebar band | GET /ajax/side/searchBand | similar to hotSearch, shown on homepage sidebar |
| getHotTimeline | hot/trending posts feed | GET /ajax/feed/hottimeline | popular posts with cursor pagination (since_id/max_id) |
| getPostDetail | single post full content | GET /ajax/statuses/show?id= | text, images, repost/comment/like counts, author info, long text |
| getPostComments | comments on a post | GET /ajax/statuses/buildComments?id= | paginated via max_id, sort by hot or time |
| getUserProfile | user profile info | GET /ajax/profile/info?uid= | name, bio, followers, verification, avatar |
| getUserDetail | user extended detail | GET /ajax/profile/detail?uid= | IP location, birthday, registration date, education |
| getUserTimeline | user's posts | GET /ajax/statuses/mymblog?uid= | page-based pagination, filter by type (all/original/image/video) |
| searchPosts | search posts by keyword | GET /ajax/side/search?q= | returns matching posts from sidebar search |
| getIndexBand | categorized trending lists | GET s.weibo.com/ajax_Indexband/getIndexBand | trending topics by category |

## API Architecture

- **Single API host**: `weibo.com` — all AJAX endpoints under `/ajax/` path
- **Secondary host**: `s.weibo.com` for index band (search page trending data)
- **Auth**: cookie_session — `SUB` cookie for session, `XSRF-TOKEN` cookie → `X-XSRF-TOKEN` header for CSRF
- **Transport**: page (L3) — browser fetch required due to cookie auth and potential bot detection
- **Pagination**: cursor-based (`since_id`/`max_id`) for feeds, page-based for user timeline

## Known Issues

- **Login required** — all operations need an active Weibo session (SUB cookie)
- **Rate limiting** — aggressive rate limits on search and feed APIs; may return 418 or empty data
- **CSRF token rotation** — XSRF-TOKEN cookie rotates; the adapter fetches within the browser context so this is handled automatically
- **search endpoint** — `/ajax/side/search` returns sidebar-style results; the full search at `s.weibo.com/weibo?q=` returns server-rendered HTML (not JSON API) and is not covered
- **Long text truncation** — posts over ~140 chars are truncated unless `isGetLongText=true` is set in getPostDetail
