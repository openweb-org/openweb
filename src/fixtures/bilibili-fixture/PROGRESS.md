# Bilibili Fixture Progress

## 2026-03-24: Initial discovery and fixture creation

**What changed:**
- Discovered Bilibili API architecture: REST APIs at `api.bilibili.com/x/` with Wbi signing
- Built L3 adapter with 10 operations via page transport
- searchVideos: intercepts `/x/web-interface/wbi/search/all/v2` from search.bilibili.com page
- getVideoDetail: fetches `/x/web-interface/view` via in-page fetch — returns full stats
- getPopularVideos: intercepts `/x/web-interface/popular` — paginated trending list
- getRanking: intercepts `/x/web-interface/ranking/v2` — top 100 by category
- getVideoComments: fetches `/x/v2/reply/main` (non-wbi) — replies with author, likes
- getUserInfo: fetches `/x/space/acc/info` — profile, VIP, live room
- getUserFollowStats: fetches `/x/relation/stat` — follower/following counts
- getUploaderStats: fetches `/x/space/upstat` — total views, likes
- getUserVideos: fetches `/x/space/arc/search` — user's uploaded videos
- getRecommendedFeed: intercepts `/x/web-interface/wbi/index/top/feed/rcmd` — personalized feed

**Why:**
- Expanding openweb coverage to Chinese video platforms
- Bilibili is the largest video-sharing platform in China

**Verification:**
- API-level: all 10 operations PASS
- Content-level: search returns 20 videos with titles/play counts, video detail returns full stats (10M+ views, 1M+ likes on test video), popular returns 20 trending videos, ranking returns 100 videos, comments returns 21 replies with user info

**Key decisions:**
- Used non-wbi endpoints (`/x/v2/reply/main`, `/x/space/acc/info`, `/x/space/arc/search`) as primary for endpoints that work without Wbi signing, with fallback to page navigation interception for wbi endpoints
- Page transport required because Wbi signing keys are derived from browser JS at `/x/web-interface/nav`
