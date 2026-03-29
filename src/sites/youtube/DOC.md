# YouTube

## Overview
Video content platform. InnerTube JSON API on `www.youtube.com`.

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

## Operations
| Operation | Intent | Method | Safety | Notes |
|-----------|--------|--------|--------|-------|
| searchVideos | search by keyword | POST /search | read | titles, thumbnails, videoIds, channel names, view counts |
| browseContent | browse feeds | POST /browse | read | browseId: FEwhat_to_watch, FEtrending, UC..., VL... |
| getVideoDetail | video detail | POST /next | read | title, description, views, likes, comments, recommendations |
| getVideoPlayer | player info | POST /player | read | stream URLs, formats, captions, playability status |
| getGuide | sidebar nav | POST /guide | read | subscriptions, categories, library links |
| getTranscript | video transcript | POST /get_transcript | read | requires params token from getVideoDetail engagement panel |
| getNotificationCount | notification count | POST /notification/get_unseen_count | read | requires sapisidhash auth |
| likeVideo | like a video | POST /like/like | write/SAFE | requires sapisidhash auth, reversible |
| unlikeVideo | remove like | POST /like/removelike | write/SAFE | requires sapisidhash auth |
| subscribeChannel | subscribe to channel | POST /subscription/subscribe | write/SAFE | requires sapisidhash auth, reversible |

### browseId Patterns
- **Home feed:** `FEwhat_to_watch`
- **Trending:** `FEtrending`
- **Subscriptions:** `FEsubscriptions`
- **Channel:** `UC...` (e.g. `UCsBjURrPoezykLs9EqgamOA`)
- **Playlist:** `VL` + playlist ID (e.g. `VLPLWKjhJtqVAbkArDMaJhn2XB080UlFNRCt`)

### getTranscript Workflow
The `/get_transcript` endpoint requires a `params` token, not a direct videoId. To get a transcript:
1. Call `getVideoDetail` with the videoId
2. Find the engagement panel in the response: `engagementPanels[].engagementPanelSectionListRenderer` with `panelIdentifier: "engagement-panel-searchable-transcript"`
3. Extract the `params` value from the continuation inside
4. Pass that `params` to `getTranscript`

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
- `clientVersion` changes frequently — may need updating when YouTube deploys
- `getVideoPlayer` returns `UNPLAYABLE` status without auth — video details available but stream URLs restricted
- Authenticated operations (like, unlike, subscribe, notifications) require sapisidhash which needs browser login
- `/get_transcript` requires a params token from `/next` engagement panel — not directly callable with just a videoId. The params token is session-bound; the endpoint returns FAILED_PRECONDITION without a valid session context. Works from browser context.
- Trending browse (`FEtrending`) may return 400 on some regions
- Large response payloads (100KB+) with deeply nested renderer structures
- All endpoints are POST, so `openweb verify` skips them by default (use `--include-writes` or manual testing)
