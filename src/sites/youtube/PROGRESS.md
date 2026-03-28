## 2026-03-28: Initial compile — clean rediscovery

**What changed:**
- Compiled 5 HTTP operations for 5 target intents
- Auth: none required (public InnerTube API), Transport: node
- Operations: searchVideos, getVideoDetail, getVideoPlayer, browseContent, getGuide
- Manually curated spec — auto-generated spec had 23 ops (18 noise: stats, ads, JS bundles, log_event)
- Added request body schemas manually (gzip-compressed bodies in HAR prevented auto-extraction)

**Why:**
- Clean rediscovery as part of openweb site pipeline improvement

**Verification:** all 5 target intents return real data via exec
- searchVideos: returns video titles, IDs, view counts
- getVideoDetail: returns full metadata (title, views, channel, comments, recommendations)
- getVideoPlayer: returns player config and streaming data
- browseContent: returns channel pages and home feed
- getGuide: returns sidebar navigation
