# YouTube

## Overview
Video content platform. InnerTube JSON API on `www.youtube.com`.

## Workflows

### Search and watch a video
1. `searchVideos(query)` → video titles, thumbnails, `videoId`s
2. `getVideoDetail(videoId)` → title, description, comments, recommendations
3. `getVideoPlayer(videoId)` → stream URLs, formats, captions

### Browse a channel or playlist
1. `browseContent(browseId: "FEwhat_to_watch")` → homepage video grid with `videoId`s
2. `browseContent(browseId: "UC...")` → channel page with tabs, videos
3. `browseContent(browseId: "VL...")` → playlist contents

### Get a video transcript
1. `getVideoDetail(videoId)` → find `engagementPanels[].engagementPanelSectionListRenderer` with `panelIdentifier: "engagement-panel-searchable-transcript"` → extract `params` token
2. `getTranscript(params)` → timestamped transcript lines

> **Note:** `getTranscript` requires a `params` token from `getVideoDetail`, not a direct videoId. The params token is session-bound; the endpoint may return FAILED_PRECONDITION without valid session context.

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchVideos | search by keyword | query | videoId, title, channelName, viewCount, duration, thumbnail | entry point |
| browseContent | browse feeds/channels | browseId (FEwhat_to_watch, FEtrending, UC..., VL...) | video grids, channel tabs, metadata | see browseId patterns below |
| getVideoDetail | video metadata + comments | videoId ← searchVideos | title, description, viewCount, likes, publishDate, comments, recommendations | |
| getVideoPlayer | player + stream info | videoId ← searchVideos | streamingData, formats, captions, playabilityStatus | stream URLs restricted without auth |
| getGuide | sidebar navigation | — | subscriptions, explore categories, library links | |
| getTranscript | video transcript | params ← getVideoDetail engagement panel | timestamped transcript lines | not in openapi.yaml — see Known Issues |
| getNotificationCount | unseen notifications | — | unseenCount | requires sapisidhash auth |
| likeVideo | like a video | videoId ← searchVideos | confirmation | requires sapisidhash auth, SAFE (reversible) |
| unlikeVideo | remove like | videoId ← searchVideos | confirmation | requires sapisidhash auth |
| subscribeChannel | subscribe to channel | channelIds | confirmation | requires sapisidhash auth, SAFE (reversible) |

### browseId Patterns
- **Home feed:** `FEwhat_to_watch`
- **Trending:** `FEtrending`
- **Subscriptions:** `FEsubscriptions`
- **Channel:** `UC...` (e.g. `UCsBjURrPoezykLs9EqgamOA`)
- **Playlist:** `VL` + playlist ID (e.g. `VLPLWKjhJtqVAbkArDMaJhn2XB080UlFNRCt`)

## Quick Start

```bash
# Search videos
openweb youtube exec searchVideos '{"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "context": {"client": {"clientName": "WEB", "clientVersion": "2.20260325.08.00"}}, "query": "machine learning tutorial"}'

# Get video detail (title, description, comments, recommendations)
openweb youtube exec getVideoDetail '{"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "context": {"client": {"clientName": "WEB", "clientVersion": "2.20260325.08.00"}}, "videoId": "dQw4w9WgXcQ"}'

# Get video player info (stream URLs, formats, captions)
openweb youtube exec getVideoPlayer '{"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "context": {"client": {"clientName": "WEB", "clientVersion": "2.20260325.08.00"}}, "videoId": "dQw4w9WgXcQ"}'

# Browse homepage
openweb youtube exec browseContent '{"key": "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "context": {"client": {"clientName": "WEB", "clientVersion": "2.20260325.08.00"}}, "browseId": "FEwhat_to_watch"}'
```

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.
Not needed for basic site usage.

## API Architecture
- **InnerTube API** — all endpoints are POST to `/youtubei/v1/*` with JSON body
- Every request requires `context.client` block with `clientName: "WEB"` and `clientVersion`
- API key passed as `?key=` query param (public key from page global `ytcfg`)
- Responses are large nested JSON with renderer patterns (e.g., `videoRenderer`, `compactVideoRenderer`)
- Single `/browse` endpoint serves channels, playlists, and home feed via `browseId`

## Auth
- **Public access:** `page_global` — extracts InnerTube API key from `ytcfg.data_.INNERTUBE_API_KEY` on YouTube page. Works for search, browse, next, player, guide, transcript.
- **Authenticated:** `sapisidhash` signing — reads `SAPISID` cookie, computes SHA-1 hash with origin (`https://www.youtube.com`), injects as `Authorization: SAPISIDHASH <timestamp>_<hash>`. Needed for likes, notifications, subscriptions.
- **CSRF:** Not observed separately — sapisidhash serves as both auth and request integrity.

## Transport
- `node` — InnerTube API accepts direct HTTP with API key. No browser needed for public operations.

## Known Issues
- `getTranscript` has an example file but no openapi.yaml entry — cannot be executed via `openweb exec`. The params token is session-bound and the endpoint returns FAILED_PRECONDITION without valid session context.
- `clientVersion` changes frequently — may need updating when YouTube deploys
- `getVideoPlayer` returns `UNPLAYABLE` status without auth — video details available but stream URLs restricted
- Authenticated operations (like, unlike, subscribe, notifications) require sapisidhash which needs browser login
- Trending browse (`FEtrending`) may return 400 on some regions
- Large response payloads (100KB+) with deeply nested renderer structures
- All endpoints are POST, so `openweb verify` skips them by default (use `--include-writes` or manual testing)
