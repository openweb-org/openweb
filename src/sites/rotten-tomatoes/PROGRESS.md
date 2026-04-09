## 2026-04-09: Initial site package

**What changed:**
- Created rotten-tomatoes site package with 3 operations: searchMovies, getMovieDetail, getTomatoMeter
- Adapter-based extraction: DOM attributes (search), LD+JSON + media-scorecard (detail/scores)
- Page transport (DOM extraction requires browser rendering)
- No auth required — all data is publicly accessible

**Why:**
- Rotten Tomatoes has no public API — all data is server-rendered HTML
- Search uses custom web components (`search-page-media-row`) with rich data attributes
- Movie detail pages embed LD+JSON (schema.org Movie) for structured data
- Scores live in `media-scorecard` web component slots

**Verification:** browser probe confirmed data extraction paths; build + verify pending
