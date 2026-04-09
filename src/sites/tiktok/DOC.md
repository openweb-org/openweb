# TikTok

## Overview
Short-video social platform. Content platform archetype.

## Workflows

### Search videos
1. `searchVideos(keyword)` → video results with id, description, author, stats
2. Paginate: use `cursor` from response as `offset` in next call while `has_more` = 1

### Get video detail
1. `getVideoDetail(username, videoId)` → full video metadata, stats, music, author

### Get user profile
1. `getUserProfile(username)` → follower/following counts, bio, video count, verified status

### Browse video and read comments
1. `getVideoDetail(username, videoId)` → video metadata
2. `getVideoComments(username, videoId)` → comments with author, likes, reply count

### Discover trending content
1. `getHomeFeed()` → recommended/trending videos from the For You page

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchVideos | search videos by keyword | keyword | id, desc, author, stats, video URLs | paginated via offset/cursor |
| getVideoDetail | get video details | username, videoId | description, stats, music, author, challenges | SSR extraction from video page |
| getUserProfile | get user profile | username | followers, following, bio, video count, verified | SSR extraction from profile page |
| getVideoComments | get comments on a video | username, videoId | comment text, author, likes, reply count | API interception from video page |
| getHomeFeed | get trending/recommended videos | — | video details, stats, authors | API interception from For You feed |

## Quick Start

```bash
# Search for cooking videos
openweb tiktok exec searchVideos '{"keyword":"cooking"}'

# Paginate (use cursor from previous response as offset)
openweb tiktok exec searchVideos '{"keyword":"cooking","offset":12,"count":5}'

# Get video details
openweb tiktok exec getVideoDetail '{"username":"tiktok","videoId":"7345678901234567890"}'

# Get user profile
openweb tiktok exec getUserProfile '{"username":"charlidamelio"}'

# Get video comments
openweb tiktok exec getVideoComments '{"username":"tiktok","videoId":"7345678901234567890"}'

# Get trending/recommended videos
openweb tiktok exec getHomeFeed '{}'
```

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.
Not needed for basic site usage.

### API Architecture
- REST API at `www.tiktok.com/api/`
- Search endpoint: `/api/search/general/full/`
- Comment endpoint: `/api/comment/list/`
- Recommend endpoint: `/api/recommend/item_list/`
- Custom signing (X-Bogus, X-Gnarly, msToken) computed client-side — handled by page transport

### Auth
- `cookie_session` — browser cookies required
- Anti-bot signing (X-Bogus, X-Gnarly) generated automatically by page transport
- No CSRF required for read operations

### Transport
- `page` transport required — heavy bot detection blocks node transport
- Browser auto-starts and manages signing
- Adapter operations (getVideoDetail, getUserProfile, getVideoComments, getHomeFeed) navigate to pages and extract from SSR data (`__UNIVERSAL_DATA_FOR_REHYDRATION__`) or intercept API responses

### Runtime Lanes
- **searchVideos**: replay lane — direct API call via page transport
- **getVideoDetail, getUserProfile**: adapter lane — SSR extraction from `__UNIVERSAL_DATA_FOR_REHYDRATION__.__DEFAULT_SCOPE__` with DOM fallback
- **getVideoComments, getHomeFeed**: adapter lane — API response interception with SSR/DOM fallback

### Known Issues
- Heavy bot detection: X-Bogus, X-Gnarly, msToken are computed client-side
- SSR data structure varies: `__UNIVERSAL_DATA_FOR_REHYDRATION__` scopes include `webapp.video-detail`, `webapp.user-detail`
- Large responses (~345KB) auto-spill to temp files
- Comments may require scrolling to trigger lazy-loaded API calls
