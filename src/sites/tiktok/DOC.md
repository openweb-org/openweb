# TikTok

## Overview
Short-video social platform. Content platform archetype.

## Workflows

### Search videos
1. `searchVideos(keyword)` → video results with id, description, author, stats
2. Paginate: use `cursor` from response as `offset` in next call while `has_more` = 1

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchVideos | search videos by keyword | keyword | id, desc, author, stats, video URLs | paginated via offset/cursor |

## Quick Start

```bash
# Search for cooking videos
openweb tiktok exec searchVideos '{"keyword":"cooking"}'

# Paginate (use cursor from previous response as offset)
openweb tiktok exec searchVideos '{"keyword":"cooking","offset":12,"count":5}'
```

---

## Site Internals

## API Architecture
- REST API at `www.tiktok.com/api/`
- Search endpoint: `/api/search/general/full/`
- Custom signing (X-Bogus, X-Gnarly, msToken) computed client-side — handled by page transport

## Auth
- `cookie_session` — browser cookies required
- Anti-bot signing (X-Bogus, X-Gnarly) generated automatically by page transport
- No CSRF required for read operations

## Transport
- `page` transport required — heavy bot detection blocks node transport
- Browser auto-starts and manages signing

## Known Issues
- Heavy bot detection: X-Bogus, X-Gnarly, msToken are computed client-side
- Search results are also available via SSR (`__UNIVERSAL_DATA_FOR_REHYDRATION__`) on initial page load
- Large responses (~345KB) auto-spill to temp files
