# Bilibili

## Overview
Chinese video sharing and social platform (similar to YouTube). Archetype: Chinese Web / Video + Social.

## Quick Start

```bash
# Search videos by keyword
openweb bilibili exec searchVideos '{"keyword": "编程"}'

# Get popular/trending videos
openweb bilibili exec getPopularVideos '{"pn": 1, "ps": 5}'

# Get video detail by BV ID
openweb bilibili exec getVideoDetail '{"bvid": "BV1MBXPBtEbk"}'

# Get video comments
openweb bilibili exec getVideoComments '{"oid": 123456, "type": 1}'

# Get user profile
openweb bilibili exec getUserProfile '{"mid": 1695320}'

# Search user's uploaded videos
openweb bilibili exec searchUserVideos '{"mid": 1695320, "pn": 1}'

# Get personalized recommended feed
openweb bilibili exec getRecommendedFeed '{"ps": 10}'

# Like a video (requires auth + write permission)
openweb bilibili exec likeVideo '{"aid": 123456, "like": 1}'
```

## Operations

### Read (7 ops)
| Operation | Description | Key Params |
|-----------|-------------|------------|
| searchVideos | Search videos by keyword | `keyword` (required), `page`, `page_size` |
| getVideoDetail | Full video metadata, stats, tags | `bvid` (required) |
| getVideoComments | Comments with replies | `oid` (required), `type`, `mode` |
| getPopularVideos | Trending/popular videos | `pn`, `ps` |
| getUserProfile | User profile, avatar, bio, level | `mid` (required) |
| searchUserVideos | User's uploaded videos (paginated, sortable) | `mid` (required), `pn`, `ps`, `order` |
| getRecommendedFeed | Personalized video feed | `ps`, `fresh_type` |

### Write (3 ops, require auth + write permission)
| Operation | Description | Key Params |
|-----------|-------------|------------|
| likeVideo | Like/unlike a video (reversible) | `aid` (required), `like` (1=like, 2=unlike) |
| addToFavorites | Add/remove from favorites (reversible) | `rid` (required), `add_media_ids` (required) |
| followUploader | Follow/unfollow a user (reversible) | `fid` (required), `act` (1=follow, 2=unfollow) |

## Auth
- Type: `cookie_session` (SESSDATA, bili_jct, DedeUserID cookies)
- Most read operations work without auth
- Write operations require `bili_jct` cookie as `csrf` form param
- Wbi-signed endpoints need browser context for automatic signing

## Transport
- **node**: default transport for cookie-based requests
- **page** (L3 adapter): required for Wbi-signed endpoints and write operations
- Adapter: `bilibili-web` — handles page navigation, API interception, Wbi signing, CSRF

## API Architecture
- REST API on `api.bilibili.com`
- JSON responses wrapped in `{code, message, data}` envelope
- `code: 0` = success, negative codes = error (e.g. `-403` = access denied)
- Wbi signing: endpoints with `/wbi/` in path require MD5 hash of sorted params + rotating mixing key

## Known Issues
- Wbi-signed endpoints return -403 via node transport — use `--browser` flag
- Rate limiting on search and user profile endpoints
- Session cookies expire; re-login via managed browser to refresh
