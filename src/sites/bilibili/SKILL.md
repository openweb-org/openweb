# Bilibili

## Overview
Chinese video sharing and social platform (similar to YouTube). Archetype: Chinese Web / Video + Social.

## Workflows

### Browse trending and drill into a video
1. `getPopularVideos()` → browse trending → `bvid`, `aid`
2. `getVideoDetail(bvid)` → full metadata, stats → `aid`, `cid`, `owner.mid`
3. `getVideoComments(oid=aid, type=1)` → comments with `rpid`, text, likes
4. `getDanmaku(oid=cid)` → bullet comments (弹幕) with content, progress_ms

### Search and engage
1. `searchVideos(keyword)` → results → `bvid`, `author.mid`
2. `getVideoDetail(bvid)` → full video info → `aid`, `cid`, `owner.mid`
3. `likeVideo(aid=aid)` → engage (requires auth + write)
4. `unlikeVideo(aid=aid)` → undo engagement

### Favorite a video (chains via favorite folder)
1. `listFavoriteFolders()` → user's folders → `data.list[0].id` (folder media_id)
2. `getVideoDetail(bvid)` → `aid`
3. `addToFavorites(rid=aid, add_media_ids=${prev.listFavoriteFolders.data.list.0.id})` → add (requires auth + write)
4. `removeFromFavorites(rid=aid, del_media_ids=${prev.listFavoriteFolders.data.list.0.id})` → undo

### Explore a creator's content
1. `getUserProfile(mid)` → bio, level, follower count → `mid`
2. `searchUserVideos(mid)` → paginated list of uploads → `bvid`, title, play count

### Follow/unfollow flow
1. `searchVideos(keyword)` → `author.mid` or `getUserProfile(mid)` → confirm user → `mid`
2. `followUploader(fid=mid)` → follow
3. `unfollowUploader(fid=mid)` → unfollow

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getPopularVideos | browse trending videos | `pn`, `ps` | bvid, aid, title, play count, uploader, duration | entry point, no auth needed |
| searchVideos | find videos by keyword | `keyword` | bvid, title, author.mid, play, danmaku, duration | adapter op, slower |
| getVideoDetail | full video metadata + stats | `bvid` <- getPopularVideos/searchVideos | title, desc, aid, cid, owner.mid, play/like/coin/fav stats | wbi-signed |
| getVideoComments | read comments with replies | `oid` (=aid) <- getVideoDetail, `type`=1 | rpid, text, author, likes, reply_count, timestamp | wbi-signed |
| getDanmaku | bullet comments (弹幕) | `oid` (=cid) <- getVideoDetail, `segment_index` | content, progress_ms, mode, color, ctime | adapter op, protobuf decoded |
| getUserProfile | user bio, level, stats | `mid` <- searchVideos.author.mid / getVideoDetail.owner.mid | name, sign, level, face, fans_medal | wbi-signed |
| searchUserVideos | user's uploaded videos | `mid` <- getUserProfile, `pn`, `ps` | title, play, duration, bvid, created | wbi-signed |
| getRecommendedFeed | personalized feed | `ps` | bvid, title, play, uploader, duration | entry point |
| listFavoriteFolders | list user's favorite folders | — | `data.list[].id` (folder media_id), title, media_count | entry point for favorite chains, requires auth |
| likeVideo | like a video | `aid` <- getVideoDetail, `like`=1 | code, message | write, requires auth |
| unlikeVideo | unlike a video | `aid` <- getVideoDetail | code, message | write, reverse of likeVideo |
| addToFavorites | add video to favorites | `rid` (=aid) <- getVideoDetail, `add_media_ids` <- listFavoriteFolders.data.list[0].id | code, message | write, requires auth |
| removeFromFavorites | remove from favorites | `rid` (=aid) <- getVideoDetail, `del_media_ids` <- listFavoriteFolders.data.list[0].id | code, message | write, reverse of addToFavorites |
| followUploader | follow a user | `fid` (=mid) <- getUserProfile/getVideoDetail.owner.mid | code, message | write, requires auth |
| unfollowUploader | unfollow a user | `fid` (=mid) <- getUserProfile/getVideoDetail.owner.mid | code, message | write, reverse of followUploader |

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

# List your favorite folders (chain into addToFavorites)
openweb bilibili exec listFavoriteFolders '{}'

# Add a video to a favorite folder (chain media_id from listFavoriteFolders)
openweb bilibili exec addToFavorites '{"rid": 123456, "add_media_ids": "12345"}'

# Remove from favorites (requires auth + write permission)
openweb bilibili exec removeFromFavorites '{"rid": 123456, "del_media_ids": "12345"}'

# Unfollow a user (requires auth + write permission)
openweb bilibili exec unfollowUploader '{"fid": 1695320}'
```
