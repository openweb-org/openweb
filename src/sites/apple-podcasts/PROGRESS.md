## 2026-04-01: Initial discovery and compile

**What changed:**
- Discovered Apple Podcasts AMP API at `amp-api.podcasts.apple.com`
- 4 operations: searchPodcasts, getPodcast, getSearchSuggestions, getTopCharts
- Auth: page_global (MusicKit developer JWT from `window.MusicKit.getInstance().developerToken`)
- Transport: node with page_global auth extraction

**Why:**
- New site package for podcast search and browse functionality

**Verification:** compile-time verify (auth extraction pending browser)
**Commit:** pending
