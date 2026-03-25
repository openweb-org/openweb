# Apple Podcasts Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created apple-podcasts with 10 operations: searchPodcasts, searchEpisodes, getPodcastDetails, getPodcastEpisodes, getEpisodeDetails, getPodcastReviews, getTopPodcasts, getTopEpisodes, getGenreCharts, searchAll
- Created openapi.yaml, manifest.json, DOC.md, PROGRESS.md
- Created adapters/apple-podcasts-api.ts — MusicKit amp-api via browser fetch

**Why:**
- Apple Podcasts is a major podcast platform — search, discovery, and reviews are core use cases
- All 10 operations use the amp-api at `amp-api.podcasts.apple.com/v1/catalog/us/` with page transport
- Bearer token obtained from MusicKit JS developer token (public, not user auth)

**Discovery process:**
1. Browsed homepage, search pages, podcast detail pages, charts, and genre pages via CDP
2. Captured network traffic — identified amp-api as sole data source for dynamic content
3. Discovered MusicKit JS provides developer token via `MusicKit.getInstance().developerToken`
4. Tested 10 amp-api endpoints: search (podcasts/episodes), detail (podcast/episode), episodes list, reviews, charts (top/genre), search groups
5. Verified all return structured JSON with consistent `{ data: [...] }` / `{ results: { ... } }` shapes

**Verification:** All 10 endpoints return 200 with valid data. Search returns podcast/episode objects with full metadata. Detail endpoints return comprehensive attributes (artwork, feedUrl, description). Reviews include rating (1-5), title, text, username. Charts return ranked lists filterable by genre.

**Knowledge updates:** Apple Podcasts uses MusicKit amp-api (same infrastructure as Apple Music). Developer token is a public JWT — no user auth needed for read operations. Token is available via `MusicKit.getInstance().developerToken` in browser context where podcasts.apple.com has been loaded. Categories endpoint (/categories) returns 500 — genre info available as `genreNames` attribute on podcast objects. Offset-based pagination (not cursor/bookmark).
