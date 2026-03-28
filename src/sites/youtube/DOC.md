# YouTube

## Overview
Video sharing and streaming platform (Content Platform archetype). Powered by Google's InnerTube API.

## Quick Start

```bash
# Search videos
pnpm dev youtube exec searchVideos '{"query": "javascript tutorial"}'

# Get video detail (metadata, comments, recommendations)
pnpm dev youtube exec getVideoDetail '{"videoId": "dQw4w9WgXcQ"}'

# Get video player info (streams, captions)
pnpm dev youtube exec getVideoPlayer '{"videoId": "dQw4w9WgXcQ"}'

# Browse channel page
pnpm dev youtube exec browseContent '{"browseId": "UCX6OQ3DkcsbYNE6H8uQQuVA"}'

# Browse home feed
pnpm dev youtube exec browseContent '{"browseId": "FEwhat_to_watch"}'

# Get sidebar navigation
pnpm dev youtube exec getGuide '{}'
```

Context defaults to `{client: {clientName: "WEB", clientVersion: "2.20260325", hl: "en", gl: "US"}}`. Override by passing `context` explicitly.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchVideos | Search videos by keyword | POST /youtubei/v1/search | Returns videoRenderer items with title, viewCount, videoId |
| getVideoDetail | Get video metadata + comments + recommendations | POST /youtubei/v1/next | Rich response: primary info, secondary info, comments, related videos |
| getVideoPlayer | Get video player config + streaming URLs | POST /youtubei/v1/player | Returns streamingData, videoDetails, captions |
| browseContent | Browse channels, home feed, playlists | POST /youtubei/v1/browse | browseId: UC... for channels, FEwhat_to_watch for home |
| getGuide | Get sidebar navigation | POST /youtubei/v1/guide | Categories and subscriptions sidebar |

## API Architecture
YouTube uses the **InnerTube API** — all operations are POST requests to `/youtubei/v1/{endpoint}` with a JSON body containing a `context` object:
```json
{
  "context": {
    "client": {
      "clientName": "WEB",
      "clientVersion": "2.20260325"
    }
  },
  "videoId": "..."
}
```
- `clientVersion` should match the current YouTube web client version (check ytcfg for latest)
- All endpoints accept the same `context` structure
- Responses are large nested JSON (hundreds of KB) with renderer objects

## Auth
- **No auth required** for public operations (search, video detail, player, browse)
- Authenticated features (subscriptions, history, liked videos) require Google cookies + `sapisidhash` signing
- `sapisidhash`: SHA-1 of `timestamp + " " + SAPISID cookie + " " + origin` — only needed for authenticated operations

## Transport
- **node** — all 5 operations work via plain HTTP POST without cookies or browser
- No bot detection for InnerTube API (it's designed for the web client)

## Known Issues
- `clientVersion` in the context may need updating as YouTube deploys new versions
- `FEtrending` browseId returns 400 — use `FEwhat_to_watch` for home/recommendations instead
- Request bodies were gzip-compressed in captured traffic, preventing automatic schema extraction by the pipeline
- Response payloads are very large (500KB+) due to deeply nested renderer structures
- Some browse IDs (like trending categories) may require additional `params` field with encoded continuation tokens
