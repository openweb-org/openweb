# bilibili

Chinese video platform with danmaku (bullet comments).

## Auth & Transport

- **Transport:** node
- **Auth:** cookie_session
- **CSRF:** None (removed — auto-detected `CURRENT_QUALITY`/`content-length` was a false positive)

## Quick Start

```bash
# Get video detail
openweb bilibili exec getVideoDetail '{"bvid": "BV1xx411c7mD"}'

# Get popular videos
openweb bilibili exec getPopularVideos

# Search suggestions
openweb bilibili exec searchSuggest '{"term": "编程"}'

# Get danmaku for a video segment
openweb bilibili exec getDanmaku '{"oid": "12345", "segment_index": "1"}'

# Get navigation/user info
openweb bilibili exec getNav
```

## Operations (17)

| Operation | Description | Permission |
|-----------|-------------|------------|
| getVideoDetail | Get video detail info | read |
| getPopularVideos | Get popular video list | read |
| getVideoCards | Get video recommendation cards | read |
| getVideoOnlineCount | Get online viewer count | read |
| getVideoRelation | Get user relation to a video | read |
| getPlayerInfo | Get video player info | read |
| getDanmaku | Get danmaku (bullet comments) | read |
| getDanmakuMeta | Get danmaku metadata | read |
| getNav | Get navigation and current user info | read |
| getUserRelation | Get relationship to another user | read |
| getWatchHistory | Get watch history | read |
| searchSuggest | Get search suggestions | read |
| getSearchDefault | Get default search term | read |
| getLiveRecommend | Get live stream recommendations | read |
| getLiveRoomInfo | Get live room basic info | read |
| getUnreadMessages | Get unread message counts | read |
| likeVideo | Like or unlike a video | write |
