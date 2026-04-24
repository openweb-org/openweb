## 2026-04-24: Userflow QA — schema fix

**Personas tested:**
1. Commuter — searchMusic "workout motivation playlist" → getAlbum → getSong → getPlaylist → getUpNext
2. Music Explorer — searchMusic "indie rock 2026" → getArtist → getAlbum → getSearchSuggestions
3. DJ — browseCharts → getPlaylist (trending) → getSong → getUpNext → browseHome

**Issues found & fixed:**
- getPlaylist schema mismatch: `background` was required but album-backed playlists (VLOLAK…) omit it → made optional

**Noted (not fixed):**
- getSong returns `playabilityStatus: UNPLAYABLE` without auth — expected, schema documents it
- Responses are 100KB–1MB raw InnerTube JSON; no L3 adapters exist for response trimming (pipeline gap)

**All 9 ops verified green, no regressions.**

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
