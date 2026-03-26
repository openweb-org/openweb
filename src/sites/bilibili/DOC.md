# Bilibili (哔哩哔哩)

## Overview
China's largest video-sharing platform (similar to YouTube). Archetype: Video/Social Media.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchVideos | search videos by keyword | Intercept `/x/web-interface/wbi/search/all/v2` from search.bilibili.com | Returns titles, authors, play counts, thumbnails |
| getVideoDetail | get video details | Intercept `/x/web-interface/view` from video page | Title, desc, stats (views, likes, coins, favorites, danmaku) |
| getPopularVideos | get trending/hot videos | Intercept `/x/web-interface/popular` | Paginated, includes recommendation reasons |
| getRanking | get video ranking by category | Intercept `/x/web-interface/ranking/v2` | Top 100 by score, filterable by category |
| getVideoComments | get video comments | `page.evaluate(fetch)` `/x/v2/reply/wbi/main` | Top-level replies with author, likes, sub-counts |
| getUserInfo | get user profile | Intercept `/x/space/wbi/acc/info` from space page | Name, bio, avatar, level, VIP, live room status |
| getUserFollowStats | get follower/following counts | `page.evaluate(fetch)` `/x/relation/stat` | Simple follower/following count |
| getUploaderStats | get uploader total stats | `page.evaluate(fetch)` `/x/space/upstat` | Total video views, article views, likes |
| getUserVideos | search user's uploaded videos | `page.evaluate(fetch)` `/x/space/wbi/arc/search` | Paginated, sortable by date/views/favorites |
| getRecommendedFeed | get homepage recommended videos | Intercept `/x/web-interface/wbi/index/top/feed/rcmd` | Personalized feed with stats |

### Write Operations (3)
| Operation | Description | Safety |
|-----------|-------------|--------|
| likeVideo | Like/unlike a video (aid, like=1\|2) | ✅ SAFE — reversible |
| addToFavorites | Add/remove video from favorites folder (rid, add_media_ids) | ✅ SAFE — reversible |
| followUploader | Follow/unfollow a user (fid, act=1\|2) | ✅ SAFE — reversible |

## API Architecture
- REST APIs at `api.bilibili.com/x/` — all return `{ code, message, data }` envelope
- **Wbi signing**: Most endpoints require `w_rid` and `wts` query params — MD5 hash of sorted params + mixing key from `/x/web-interface/nav`
- Browser JS handles Wbi signing automatically; no need to reimplement
- Some endpoints (search, user info) use additional anti-bot params (`dm_img_str`, `dm_cover_img_str`)

## Auth
- Cookie session (`SESSDATA` cookie) for authenticated features
- Most read operations work without login
- Search, trending, ranking, video detail, comments all public
- User profile mostly public; some fields require login
- **Write operations** require `SESSDATA` + `bili_jct` cookies (CSRF token derived from `bili_jct`)

## Transport
- `page` (L3 adapter) — all operations via page navigation + API interception or in-page fetch
- Cannot downgrade to `node` — Wbi signing requires browser context to derive mixing keys
- Some simpler endpoints (`/x/relation/stat`, `/x/space/upstat`) technically work without Wbi but are called from page context for consistency

## Known Issues
- **Wbi signing changes**: Bilibili periodically rotates the Wbi mixing key algorithm. Page transport is immune to this since the browser's own JS handles signing.
- **Rate limiting**: Aggressive request patterns may trigger CAPTCHA or temporary IP blocks. Space out requests.
- **Search API path**: The actual search API is `/x/web-interface/wbi/search/all/v2` but is called from `search.bilibili.com` domain — intercepted during page navigation.
- **Video detail SSR**: Video pages embed some data in SSR HTML (`__INITIAL_STATE__`), but the `/x/web-interface/view` API call is also made by page JS.
