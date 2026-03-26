# YouTube

## Overview
YouTube InnerTube API — video platform. POST-based internal API with SAPISIDHASH signing.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getVideoInfo | video player info | POST /player | videoId in request body |
| getComments | video comments | POST /next | videoId in request body |

## API Architecture
- InnerTube API v1 at `www.youtube.com/youtubei/v1/`
- **All endpoints are POST** — parameters in JSON request body, not query string
- Every request requires `context.client` object with `clientName`, `clientVersion`, `hl`, `gl`
- API key injected as `key` query parameter

## Auth
- `page_global` — extracts InnerTube API key from `ytcfg.data_.INNERTUBE_API_KEY` on YouTube page
- **SAPISIDHASH signing**: reads `SAPISID` cookie, computes hash with origin, injects as `Authorization: SAPISIDHASH <hash>`

## Transport
- `node` — direct HTTP (with cookies forwarded for signing)

## Known Issues
- `clientVersion` in context body may need updating as YouTube deploys new versions
