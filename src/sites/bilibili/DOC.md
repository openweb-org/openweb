# Bilibili

## Overview
Chinese video sharing platform (similar to YouTube). Social/content archetype with custom Wbi signing.

## Quick Start

```bash
# Get popular/trending videos
openweb bilibili exec getPopularVideos '{"pn": 1, "ps": 20}'

# Get video ranking (all categories)
openweb bilibili exec getRanking '{"rid": 0, "type": "all"}'

# Get user profile
openweb bilibili exec getUserInfo '{"mid": 546195}'

# Get user's uploaded videos
openweb bilibili exec getUserVideos '{"mid": 546195, "pn": 1, "ps": 25}'

# Get video comments
openweb bilibili exec getVideoComments '{"oid": 170001, "type": 1}'

# Get related videos for a BV ID
openweb bilibili exec getRelatedVideos '{"bvid": "BV1xx411c7mD"}'

# Get user follow/follower stats
openweb bilibili exec getUserFollowStats '{"vmid": 546195}'
```

## Operations
| Operation | Intent | Method | Transport | Notes |
|-----------|--------|--------|-----------|-------|
| getPopularVideos | Browse trending videos | GET /x/web-interface/popular | node | Paginated (pn/ps) |
| getRanking | View category rankings | GET /x/web-interface/ranking/v2 | adapter (Wbi) | rid=0 for all categories |
| getUserInfo | View user profile | GET /x/space/wbi/acc/info | adapter (Wbi) | Returns name, face, sign, level, vip |
| getUserFollowStats | View follower counts | GET /x/relation/stat | node | following, follower counts |
| getUploaderStats | View uploader metrics | GET /x/space/upstat | node | Total views, article views, likes |
| getUserVideos | Browse user's videos | GET /x/space/wbi/arc/search | adapter (Wbi) | Paginated, sortable |
| getVideoComments | Read video comments | GET /x/v2/reply/wbi/main | adapter (Wbi) | Cursor-based pagination |
| getRelatedVideos | Discover similar videos | GET /x/web-interface/archive/related | node | By bvid |
| getVideoOnlineCount | See live viewer count | GET /x/player/online/total | node | Requires bvid + cid |
| getNavInfo | Check login status | GET /x/web-interface/nav | node | Also returns Wbi signing keys |

## API Architecture
- REST API on `api.bilibili.com` with JSON responses
- All responses wrap data in `{code, message, data}` envelope
- `code: 0` = success, `code: -352` = Wbi signing required, `code: -403` = access denied
- Video IDs: BV (bvid string like "BV1xx411c7mD") and AV (aid integer) — both work
- User IDs: `mid` (integer)

## Auth
- **Type**: cookie_session (SESSDATA, bili_jct, DedeUserID)
- **Public access**: Most read operations work without login
- **CSRF**: bili_jct cookie used as `csrf` POST body param (not header-based)
- **Wbi signing**: Required for `/wbi/` endpoints — MD5 hash of sorted params + rotating mixing key

## Transport
- **Node**: Public endpoints without Wbi (getPopularVideos, getUserFollowStats, etc.)
- **Adapter (page)**: Wbi-signed endpoints (getUserInfo, getUserVideos, getVideoComments, getRanking)
- The adapter computes Wbi signing in-browser: fetches nav API for keys, builds MD5 signature, appends w_rid + wts

## Known Issues
- **Wbi key rotation**: The img_key and sub_key URLs rotate periodically. The adapter fetches fresh keys on each call.
- **Rate limiting**: Aggressive rate limiting on API calls. Space out requests.
- **Geo-blocking**: Some content/APIs may be restricted by region.
- **Search not covered**: Video search API lives on search.bilibili.com (off-domain) — not yet captured.
- **Video detail not covered**: Video detail data comes from SSR (`window.__INITIAL_STATE__`) on video pages, not a clean API endpoint. Use getRelatedVideos to discover videos.
