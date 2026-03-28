## 2026-03-28: Initial compile (rediscovery)

**What changed:**
- Compiled 10 HTTP operations for 5 target intents (popular, ranking, user profile, user videos, comments)
- Auth: cookie_session (public access), Transport: node + adapter (Wbi signing)
- Created bilibili-web adapter for Wbi-signed endpoints (MD5 signing in browser context)
- Curated from 94 auto-generated operations down to 10 useful operations

**Why:**
- Clean rediscovery from scratch — no existing site package
- Cover core content consumption intents (browse, discover, user profiles)

**Verification:** 10/10 operations return real data via exec
- Node transport: getPopularVideos, getUserFollowStats, getUploaderStats, getRelatedVideos, getVideoOnlineCount, getNavInfo
- Adapter transport: getRanking, getUserInfo, getUserVideos, getVideoComments

**Known gaps:**
- Search videos (search.bilibili.com off-domain — needs separate capture)
- Video detail (SSR-embedded data, not clean API)
