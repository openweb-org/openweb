# Bilibili

## Overview
Chinese video sharing and social platform (similar to YouTube). Archetype: Chinese Web / Video + Social.

## Workflows

### Browse trending and drill into a video
1. `getPopularVideos` → browse trending → `bvid`, `aid`
2. `getVideoDetail(bvid)` → full metadata, stats → `aid`, `cid`, `owner.mid`
3. `getVideoComments(oid=aid, type=1)` → read comments
4. `getDanmaku(oid=cid)` → read bullet comments

### Search and engage
1. `searchVideos(keyword)` → results with `bvid`, `mid`
2. `getVideoDetail(bvid)` → full video info → `aid`
3. `likeVideo(aid)` / `addToFavorites(rid=aid)` → engage (requires auth + write)
4. `unlikeVideo(aid)` / `removeFromFavorites(rid=aid)` → undo engagement

### Explore a creator's content
1. `getUserProfile(mid)` → bio, level, follower count
2. `searchUserVideos(mid)` → paginated list of uploads → `bvid`

### Follow/unfollow flow
1. `getUserProfile(mid)` → check user info
2. `followUploader(fid=mid)` → follow
3. `unfollowUploader(fid=mid)` → unfollow

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getPopularVideos | browse trending videos | `pn`, `ps` | bvid, title, play count, uploader, duration | entry point, no auth needed |
| searchVideos | find videos by keyword | `keyword` | bvid, title, author, play, danmaku, duration | adapter op, slower |
| getVideoDetail | full video metadata + stats | `bvid` ← getPopularVideos/searchVideos | title, desc, play/like/coin/fav stats, cid, owner.mid | wbi-signed |
| getVideoComments | read comments with replies | `oid` (=aid) ← getVideoDetail, `type`=1 | comment text, author, likes, reply count, timestamp | wbi-signed |
| getDanmaku | bullet comments (弹幕) | `oid` (=cid) ← getVideoDetail, `segment_index` | content, progress_ms, mode, color, ctime | adapter op, protobuf decoded |
| getUserProfile | user bio, level, stats | `mid` ← searchVideos/getVideoDetail | name, sign, level, face, fans_medal | wbi-signed |
| searchUserVideos | user's uploaded videos | `mid` ← getUserProfile, `pn`, `ps` | title, play, duration, bvid, created | wbi-signed |
| getRecommendedFeed | personalized feed | `ps` | bvid, title, play, uploader, duration | entry point |
| likeVideo | like/unlike a video | `aid` ← getVideoDetail, `like` (1/2) | code, message | write, requires auth |
| addToFavorites | add/remove from favorites | `rid` (=aid) ← getVideoDetail, `add_media_ids` | code, message | write, requires auth |
| followUploader | follow/unfollow user | `fid` (=mid) ← getUserProfile, `act` (1/2) | code, message | write, requires auth |
| unlikeVideo | unlike a previously liked video | `aid` ← getVideoDetail | code, message | reverse of likeVideo, write, requires auth |
| removeFromFavorites | remove video from favorites | `rid` (=aid) ← getVideoDetail, `del_media_ids` | code, message | reverse of addToFavorites, write, requires auth |
| unfollowUploader | unfollow a user | `fid` (=mid) ← getUserProfile | code, message | reverse of followUploader, write, requires auth |

## Quick Start

```bash
# Browse trending videos
openweb bilibili exec getPopularVideos '{"pn": 1, "ps": 5}'

# Get personalized feed
openweb bilibili exec getRecommendedFeed '{"ps": 10}'

# Search videos by keyword (adapter, slower)
openweb bilibili exec searchVideos '{"keyword": "编程"}'

# Get video detail by BV ID
openweb bilibili exec getVideoDetail '{"bvid": "BV1MBXPBtEbk"}'

# Get video comments (oid = aid from getVideoDetail)
openweb bilibili exec getVideoComments '{"oid": 123456, "type": 1}'

# Get danmaku / bullet comments (oid = cid from getVideoDetail)
openweb bilibili exec getDanmaku '{"oid": 1176840, "segment_index": 1}'

# Get user profile
openweb bilibili exec getUserProfile '{"mid": 1695320}'

# Search user's uploaded videos
openweb bilibili exec searchUserVideos '{"mid": 1695320, "pn": 1}'

# Like a video (requires auth + write permission)
openweb bilibili exec likeVideo '{"aid": 123456, "like": 1}'

# Unlike a video (requires auth + write permission)
openweb bilibili exec unlikeVideo '{"aid": 123456}'

# Remove from favorites (requires auth + write permission)
openweb bilibili exec removeFromFavorites '{"rid": 123456, "del_media_ids": "12345"}'

# Unfollow a user (requires auth + write permission)
openweb bilibili exec unfollowUploader '{"fid": 1695320}'
```

---

## Site Internals

## API Architecture
- REST API on `api.bilibili.com`
- JSON responses wrapped in `{code, message, data}` envelope
- `code: 0` = success, negative codes = error (e.g. `-403` = access denied, `-352` = risk control)
- Wbi signing: endpoints with `/wbi/` in path require MD5 hash of sorted params + rotating mixing key

## Auth
- Type: `cookie_session` (SESSDATA, bili_jct, DedeUserID cookies)
- Most read operations work without auth
- Write operations require `bili_jct` cookie as `csrf` form param

## Transport
- **node**: default transport for API requests (getPopularVideos, getRecommendedFeed)
- **page adapter** (`bilibili-web`): searchVideos, getDanmaku, and all write ops — handles Wbi signing, CSRF, API interception
- Wbi-signed endpoints via node transport return -352/-403; these need the adapter or browser context

## Known Issues
- **Wbi endpoints fail via node transport**: getUserProfile, getVideoDetail, getVideoComments, searchUserVideos return -352 (风控校验失败) or -403 when called directly via node. These endpoints require Wbi signing that only the page adapter provides. Currently only getDanmaku and searchVideos have adapter overrides.
- Rate limiting on search and user profile endpoints
- Session cookies expire; re-login via managed browser to refresh
- Response schema enums contain captured sample data (specific video titles/descriptions) from compilation — these are not real constraints
