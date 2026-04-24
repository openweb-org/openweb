## 2026-04-24: Userflow QA — response trimming and adapter wiring

**Context:** Blind userflow QA across 3 personas (Commuter, Professional, Parent). All 4 read ops returned 200 but adapter was dead code (no `x-openweb.adapter` wiring), responses contained 170–265KB of raw AMP API bloat, and the spec documented `feedUrl`/`editorialArtwork` as available `extend` fields despite them not being returned by the API.
**Changes:**
- **Adapter wiring:** Converted adapter from legacy `init/isAuthenticated/execute` interface to `CustomRunner.run(ctx)`. Added `adapter: { name, operation }` to all 4 operations in openapi.yaml. Adapter now receives `ctx.auth.headers` from runtime page_global resolution.
- **Response trimming:** `trimResponse()` strips artwork color metadata (bgColor, textColor1-4, hasP3), offers, upsell, assetUrl (raw audio URLs), subscribable, displayType, mediaKind, mediaKinds, guid, copyright, createdDate, editorialArtwork, logoArtwork, and editorial noise fields. Artwork objects reduced to `{url, width, height}` only. Applied to all 4 operations.
- **Search trimming:** `trimSearch()` additionally strips `meta.metrics` (internal Apple tracking) and group `href`/`next` (auth-scoped pagination URLs unusable by agents).
- **Schema fixes:** Removed `feedUrl` from getPodcast response schema (API doesn't return it). Updated extend param docs. Removed `included` array (episodes come via `relationships.episodes.data`). Added `userRating`, `releaseDateTime`, `languageTag`, episode `durationInMilliseconds` to schema. Updated getTopCharts summary to reflect actual response (editorial navigation, not podcast lists).
- **Size reductions:** searchPodcasts 193→136KB, getPodcast 22→9KB, getSearchSuggestions 8.5→5.8KB, getTopCharts 23→15KB.
**Verification:** All 4 read ops PASS. No schema warnings.
**Key files:** `src/sites/apple-podcasts/adapters/apple-podcasts-api.js`, `src/sites/apple-podcasts/openapi.yaml`

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
