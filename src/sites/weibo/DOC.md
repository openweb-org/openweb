# weibo

Chinese microblogging platform (similar to Twitter).

## Auth & Transport

- **Transport:** node
- **Auth:** cookie_session
- **CSRF:** None (removed — auto-detected `_s_tentry`/`:authority` was a false positive)

## Quick Start

```bash
# Get hot search topics
openweb weibo exec getHotSearch

# Get hot trending topics
openweb weibo exec getHotTrending

# Search Weibo content
openweb weibo exec search '{"q": "人工智能"}'

# Get unread notification count
openweb weibo exec getUnreadCount

# Get feed groups
openweb weibo exec getFeedGroups
```

## Operations (9)

| Operation | Description | Permission |
|-----------|-------------|------------|
| getHotSearch | Get hot search topics | read |
| getHotTrending | Get hot trending topics | read |
| search | Search Weibo content | read |
| getUnreadCount | Get unread notification count | read |
| getFeedGroups | Get feed groups for the user | read |
| getUnreadFriendsFeed | Get unread friends feed count | read |
| getUnreadMessageHint | Get unread message hints | read |
| getIndexBand | Get index banner/band info | read |
| getSideCards | Get sidebar cards | read |
