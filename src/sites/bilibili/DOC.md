# Bilibili

## Overview
Chinese video sharing and social platform (similar to YouTube). Archetype: Chinese Web / Video + Social.

## Quick Start

```bash
# Search videos by keyword (needs page transport)
openweb bilibili exec searchVideos '{"keyword": "编程"}'

# Search suggestions
openweb bilibili exec searchSuggest '{"term": "programming"}'

# Get popular/trending videos
openweb bilibili exec getPopularVideos '{"pn": 1, "ps": 5}'

# Get video ranking by category
openweb bilibili exec getRanking '{}'

# Get video detail by BV ID
openweb bilibili exec getVideoDetail '{"bvid": "BV1MBXPBtEbk"}'

# Get user follow statistics
openweb bilibili exec getUserFollowStats '{"vmid": 1695320}'

# Get user upload stats
openweb bilibili exec getUserStats '{"mid": 1695320}'

# Get live room info
openweb bilibili exec getLiveRoomInfo '{"room_ids": 21452505}'

# Get recommended live rooms
openweb bilibili exec getRecommendedLiveRooms '{}'
```

## Operations

### Discovery & Search (7 ops)
| Operation | Status | Notes |
|-----------|--------|-------|
| searchVideos | page | Full keyword search. Needs Wbi signing |
| searchSuggest | node | Search term suggestions |
| getSearchDefault | node | Trending search placeholder |
| getPopularVideos | node | Paginated hot videos with recommendation reasons |
| getRanking | node | Top 100 by score, filterable by category (0=all, 1=anime, 3=music, 4=game, 36=tech) |
| getRecommendedFeed | node | Personalized feed |
| getOgvRecommend | node | Anime/drama/movie recommendations. Requires season_type param |

### Video Detail (8 ops)
| Operation | Status | Notes |
|-----------|--------|-------|
| getVideoDetail | node | Full metadata, stats, tags, parts. Use bvid param |
| getVideoComments | page | Needs Wbi signing. Requires oid + type |
| getCommentAreaInfo | node | Comment count, area status |
| getVideoOnlineCount | node | Current viewer count. Requires aid + bvid + cid |
| getVideoUserRelation | node | Like/coin/fav status for current user |
| getPlayerInfo | node | Playback URLs, quality options |
| getDanmakuMeta | node* | Returns binary protobuf (not JSON) |
| getDanmakuSegment | page | Binary protobuf. Needs Wbi signing |

### User Profile (11 ops)
| Operation | Status | Notes |
|-----------|--------|-------|
| getUserProfile | page | Needs Wbi signing |
| getUserStats | node | Total views, article views, likes |
| getUserFollowStats | node | Followers, following |
| getUserRelation | page | Mutual follow, blacklist. Needs Wbi signing |
| searchUserVideos | page | Paginated, sortable. Needs Wbi signing |
| getUserSeasons | node | Series/season list |
| getUserMasterpiece | node | User's featured content |
| getUserPinnedVideo | node | User's pinned video |
| getUserContentCounts | page | HTTP 412 via node (anti-bot). Needs page transport |
| getUserAnimeSubscriptions | node | Anime subscription list. Requires type param |
| getUserFavoriteFolders | node | Collection folders |

### Live Streaming (2 ops)
| Operation | Status | Notes |
|-----------|--------|-------|
| getRecommendedLiveRooms | node | Recommended streams (default platform=web) |
| getLiveRoomInfo | node | Room status, viewer count. Uses api.live.bilibili.com |

### Session (1 op)
| Operation | Status | Notes |
|-----------|--------|-------|
| getNavInfo | node | User session, VIP, wallet |

### Write Operations (3 ops, require auth + write permission)
| Operation | Status | Notes |
|-----------|--------|-------|
| likeVideo | page | Like/unlike video. aid param, like=1 (like) or 2 (unlike). Reversible |
| addToFavorites | page | Add/remove favorites. rid + add_media_ids. Reversible |
| followUploader | page | Follow/unfollow user. fid param, act=1 (follow) or 2 (unfollow). Reversible |

**Status key**: `node` = works via node transport, `page` = needs page transport (L3 adapter), `node*` = works but returns non-JSON

## Verification Summary (2026-03-29)

- **22 PASS** via node transport (code=0 or HTTP 200)
- **4 WBI** — need page transport for Wbi signing (-403 via node): getVideoComments, getUserProfile, getUserRelation, searchUserVideos
- **1 ANTI-BOT** — need page transport (HTTP 412 via node): getUserContentCounts
- **2 BINARY** — return protobuf, not JSON: getDanmakuMeta (200), getDanmakuSegment (also needs Wbi)
- **3 AUTH** — write ops, correctly gated by permission system: likeVideo, addToFavorites, followUploader

## API Architecture
- REST API on `api.bilibili.com` (main), `api.live.bilibili.com` (live)
- JSON responses wrapped in `{code, message, data}` envelope
- `code: 0` = success, negative codes = error (e.g. `-403` = access denied, `-404` = not found)
- Wbi signing: endpoints with `/wbi/` in path require MD5 hash of sorted params + rotating mixing key

## Auth
- Type: cookie_session (SESSDATA, bili_jct, DedeUserID cookies)
- Most read operations work without auth via node transport
- Write operations require `bili_jct` cookie as `csrf` form param
- Wbi-signed endpoints need browser context for signing

## Transport
- **node**: works for 22 of 32 operations
- **page** (L3 adapter): required for Wbi-signed endpoints, anti-bot protected endpoints, and all write operations
- Adapter: `bilibili-web` — handles page navigation, API interception, Wbi signing, CSRF

## Known Issues
- Wbi-signed endpoints (`/wbi/` in path) return -403 via node transport
- `getDanmakuMeta` and `getDanmakuSegment` return binary protobuf — need specialized parsing
- `getUserContentCounts` returns HTTP 412 via node (anti-bot protection)
- Rate limiting on search and user profile endpoints
- Session cookies expire; re-login via managed browser to refresh
