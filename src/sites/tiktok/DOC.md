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
2. `getExplore()` → trending videos from the Explore/Discover page

### Like / unlike a video
1. `likeVideo(videoId)` → like a video
2. `unlikeVideo(videoId)` → reverse the like

### Follow / unfollow a user
1. `getUserProfile(username)` → get the numeric `id`
2. `followUser(userId)` → follow the user
3. `unfollowUser(userId)` → reverse the follow

### Bookmark / unbookmark a video
1. `bookmarkVideo(videoId)` → add video to favorites
2. `unbookmarkVideo(videoId)` → remove from favorites

### Comment on a video
1. `createComment(videoId, text)` → post a comment, returns `commentId`
2. `deleteComment(videoId, commentId)` → delete own comment

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchVideos | search videos by keyword | keyword | id, desc, author, stats, video URLs | paginated via offset/cursor |
| getVideoDetail | get video details | username, videoId | description, stats, music, author, challenges | SSR extraction from video page |
| getUserProfile | get user profile | username | followers, following, bio, video count, verified | SSR extraction from profile page |
| getVideoComments | get comments on a video | username, videoId | comment text, author, likes, reply count | API interception from video page |
| getHomeFeed | get trending/recommended videos | — | video details, stats, authors | API interception from For You feed |
| getExplore | get explore/discover videos | — | video details, stats, authors | API interception from Explore page |
| likeVideo | like a video | videoId | success, is_digg | write, caution — may be bot-blocked |
| unlikeVideo | unlike a video | videoId | success, is_digg | write, caution — reverse of likeVideo |
| followUser | follow a user | userId | success, follow_status | write, caution — may be bot-blocked |
| unfollowUser | unfollow a user | userId | success, follow_status | write, caution — reverse of followUser |
| bookmarkVideo | bookmark a video | videoId | success | write, caution — may be bot-blocked |
| unbookmarkVideo | unbookmark a video | videoId | success | write, caution — reverse of bookmarkVideo |
| createComment | post a comment | videoId, text | success, commentId | write, caution — may be bot-blocked |
| deleteComment | delete a comment | videoId, commentId | success | write, caution — must be comment author |

## Quick Start

```bash
# Search for cooking videos
openweb tiktok exec searchVideos '{"keyword":"cooking"}'

# Paginate (use cursor from previous response as offset)
openweb tiktok exec searchVideos '{"keyword":"cooking","offset":12,"count":5}'

# Get video details
openweb tiktok exec getVideoDetail '{"username":"tiktok","videoId":"7626810027520593183"}'

# Get user profile
openweb tiktok exec getUserProfile '{"username":"charlidamelio"}'

# Get video comments
openweb tiktok exec getVideoComments '{"username":"tiktok","videoId":"7626810027520593183"}'

# Get trending/recommended videos
openweb tiktok exec getHomeFeed '{}'

# Get explore page videos
openweb tiktok exec getExplore '{}'

# Like a video
openweb tiktok exec likeVideo '{"videoId":"7626810027520593183"}'

# Unlike a video
openweb tiktok exec unlikeVideo '{"videoId":"7626810027520593183"}'

# Follow a user (need numeric userId from getUserProfile)
openweb tiktok exec followUser '{"userId":"107955"}'

# Unfollow a user
openweb tiktok exec unfollowUser '{"userId":"107955"}'

# Bookmark a video
openweb tiktok exec bookmarkVideo '{"videoId":"7626810027520593183"}'

# Unbookmark a video
openweb tiktok exec unbookmarkVideo '{"videoId":"7626810027520593183"}'

# Post a comment
openweb tiktok exec createComment '{"videoId":"7626810027520593183","text":"Great video!"}'

# Delete a comment
openweb tiktok exec deleteComment '{"videoId":"7626810027520593183","commentId":"7345678901234567891"}'
```

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.
Not needed for basic site usage.

### API Architecture
- REST API at `www.tiktok.com/api/`
- 112+ endpoints discoverable from webpack module 47876 (endpoint registry)
- Key endpoints:
  - Read: `/api/item/detail/`, `/api/user/detail/`, `/api/comment/list/`, `/api/recommend/item_list/`, `/api/explore/item_list/`, `/api/search/general/full/`
  - Write: `/api/commit/item/digg/`, `/api/commit/follow/user/`, `/api/item/collect/`, `/api/comment/publish/`, `/api/comment/delete/`
- Signing (X-Bogus, X-Gnarly, msToken, ztca-dpop) computed by `byted_acrawler.frontierSign()` inside the fetch interceptor

### Auth
- `cookie_session` — browser cookies required
- `window.fetch` is monkey-patched (3505 chars) — automatically adds signing headers to every request
- CSRF token available from webpack HTTP client module (source pattern: `csrfToken` + `runFetch` + `fetchData`)
- Write ops inject `tt-csrf-token` header from webpack-extracted token

### Transport
- `page` transport required — `byted_acrawler` signing runs client-side only
- Read ops use API response interception (navigate to page → capture `/api/*` response)
- Write ops use `page.evaluate(fetch(...))` — the fetch interceptor handles signing
- SSR data at `__$UNIVERSAL_DATA$__.__DEFAULT_SCOPE__` used as thin fallback for getVideoDetail/getUserProfile only

### Webpack Module System
- Main app: 3787 modules in `__LOADABLE_LOADED_CHUNKS__` (injectable via `push([[Symbol()], {}, r => { req = r }])`)
- Service classes: `this.fetch.post("/api/...")` pattern, organized by domain (module 16325: like/collect, 46644: user/follow, 54553: feeds, 22890: search)
- Module IDs are per-deploy mangled — not stable across deployments
- HTTP client singleton: module with `csrfToken` + `runFetch` + `fetchData` source signature

### Adapter Patterns
- `adapters/tiktok-web.ts` is a `CustomRunner` exposing a single `run(ctx)` entry point — no `init()` or `isAuthenticated()` hooks (the former only checked the page URL, redundant with PagePlan; the latter hardcoded `true`).
- `run(ctx)` dispatches the 21 operations through an `OPERATIONS` table that preserves byte-for-byte semantics (signing infra, `interceptApi`, `internalApiCall`, `ensureTikTokPage`, CSRF token extraction).

### Runtime Lanes
- **searchVideos**: replay lane — direct API call via page transport
- **getVideoDetail, getUserProfile**: adapter lane — API intercept (`/api/item/detail/`, `/api/user/detail/`) with SSR fallback
- **getVideoComments, getHomeFeed, getExplore**: adapter lane — API intercept
- **write ops (like, follow, bookmark, comment)**: adapter lane — `page.evaluate(fetch(...))` with CSRF injection

### Known Issues
- Write ops return HTTP 200 with non-zero `status_code` on failure — check `status_code === 0`
- Browser connection fragility: sequential ops can crash CDP connection with stale browser state — restart browser before full verify run
- getVideoDetail DRIFT: shape-diff false positive on empty `challenges[]` array
- followUser/unfollowUser require numeric userId (from getUserProfile.id), not username
