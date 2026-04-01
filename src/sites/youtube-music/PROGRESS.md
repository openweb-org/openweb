## 2026-04-01: Initial discovery — 9 operations via InnerTube API

**What changed:**
- Fresh discovery of YouTube Music InnerTube API
- 9 read operations: searchMusic, getAlbum, getPlaylist, getArtist, getSong, getUpNext, getSearchSuggestions, browseHome, browseCharts
- Node transport with public API key (no auth required)
- Virtual paths (actual_path) to split browse endpoint by browseId pattern
- Const injection for InnerTube context and API key via OpenAPI schema

**Why:**
- Prior package was quarantined L3 adapter; fresh compile uses L2 node transport
- InnerTube API works directly from node without cookies or bot detection

**Verification:** Runtime verify via `openweb verify youtube-music`
