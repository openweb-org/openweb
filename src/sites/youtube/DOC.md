# YouTube

## Overview
YouTube InnerTube API — video platform. POST-based internal API with SAPISIDHASH signing.

## Operations
| Operation | Intent | Method | Permission | Notes |
|-----------|--------|--------|------------|-------|
| searchVideos | search videos by keyword | POST /search | read | query in request body |
| getVideoInfo | video player info | POST /player | read | videoId in request body |
| getRelatedAndComments | video comments and related videos | POST /next | read | videoId in request body |
| browseContent | browse channel, playlist, or home feed | POST /browse | read | browseId selects content type |
| getTranscript | video transcript/subtitles | POST /get_transcript | read | params token from engagement panel |
| likeVideo | like a video | POST /like/like | write | SAFE (reversible via unlikeVideo) |
| unlikeVideo | remove like from a video | POST /like/removelike | write | SAFE |
| subscribeChannel | subscribe to a channel | POST /subscription/subscribe | write | SAFE (reversible) |

### browseId Patterns
- **Channel:** `UC...` (e.g. `UCsBjURrPoezykLs9EqgamOA`)
- **Playlist:** `VL` + playlist ID (e.g. `VLPLWKjhJtqVAbkArDMaJhn2XB080UlFNRCt`)
- **Home feed:** `FEwhat_to_watch`

## API Architecture
- InnerTube API v1 at `www.youtube.com/youtubei/v1/`
- **All endpoints are POST** — parameters in JSON request body, not query string
- Every request requires `context.client` object with `clientName`, `clientVersion`, `hl`, `gl`
- API key injected as `key` query parameter
- Single `/browse` endpoint serves channels, playlists, and home feed via `browseId`

## Auth
- `page_global` — extracts InnerTube API key from `ytcfg.data_.INNERTUBE_API_KEY` on YouTube page
- **SAPISIDHASH signing**: reads `SAPISID` cookie, computes SHA-1 hash with origin, injects as `Authorization: SAPISIDHASH <timestamp>_<hash>`
- Write operations (like, subscribe) require SAPISIDHASH auth

## Transport
- `node` — direct HTTP (with cookies forwarded for signing)

## Known Issues
- `clientVersion` in context body may need updating as YouTube deploys new versions (currently `2.20260324.05.00`)
- `/get_transcript` requires a `params` token from the engagement panel in the `/next` response; not directly callable with just a videoId
- Trending browse (`FEtrending`) returns 400 — YouTube may have deprecated this browseId
- All endpoints are POST, so `openweb verify` skips them by default (verify needs `--include-writes` or manual testing)
