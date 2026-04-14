# Weibo

## Overview
Chinese microblogging platform (social media). China's Twitter/X equivalent with trending topics, user timelines, post detail/comments, and write operations (like, repost, follow, bookmark).

## Workflows

### Browse trending and read a post
1. `getHotSearch` → `realtime[].word`
2. `getHotFeed(group_id, containerid, extparam)` → `statuses[].mid`, `statuses[].user.id`
3. `getPost(id=mid)` → full post with text, images, engagement

### Explore a user's profile and posts
1. `getUserProfile(uid)` → `screen_name`, bio, `followers_count`, verification
2. `getUserDetail(uid)` → birthday, `ip_location`, `created_at`
3. `getUserStatuses(uid, page)` → `list[].mid`, `list[].user.id`
4. `getPost(id=mid)` → full post detail

### Read home feed and interact
1. `getFriendsFeed(list_id)` → `statuses[].mid`, `statuses[].user.id`
2. `getPost(id=mid)` → full detail with `text_raw`, `attitudes_count`
3. `likePost(id=mid)` → like the post
4. `repost(id=mid, reason)` → repost with comment
5. `bookmarkPost(id=mid)` → save to favorites

### Undo actions
1. `getFriendsFeed` / `getUserStatuses` / `getPost` → `mid`, `user.id`
2. `unlikePost(id=mid)` → remove like from post
3. `unfollowUser(friend_uid=user.id)` → unfollow user
4. `unbookmarkPost(id=mid)` → remove bookmark

### Follow a user from a post
1. `getPost(id)` → `user.id`, `user.screen_name`
2. `followUser(friend_uid=user.id)` → follow the author

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getFriendsFeed | home feed | list_id | statuses[].mid, user.id, since_id | entry point; paginate via since_id |
| getHotFeed | trending feed | group_id, containerid, extparam | statuses[].mid, user.id, total_number | entry point; 102803 = default hot |
| getHotSearch | trending topics | — | realtime[].word, num, icon_desc | entry point; top 50 |
| getUserProfile | user profile | uid | user.screen_name, followers_count, verified | entry point (with known uid) |
| getUserDetail | user extended info | uid ← getUserProfile | ip_location, created_at, birthday | |
| getUserStatuses | user's posts | uid ← getUserProfile, page | list[].mid, user.id, total | page-based pagination |
| getPost | post detail | id ← feed/statuses mid | text_raw, reposts_count, comments_count, attitudes_count, user.id, pic_infos | |
| getLongtext | full text for truncated post | id ← getPost (when isLongText=true) | longTextContent, longTextContent_raw | |
| listReposts | post reposts | id ← getPost id (numeric) | data[], total_number | page-based |
| likePost | like a post | id ← feed/getPost mid | ok, attitude | SAFE: reversible |
| repost | repost/retweet | id ← feed/getPost mid, reason | ok, statuses | SAFE: reversible (adapter) |
| followUser | follow a user | friend_uid ← getPost user.id | ok, data (user) | SAFE: reversible (adapter) |
| bookmarkPost | bookmark a post | id ← feed/getPost mid | ok, favorited_time | SAFE: reversible (adapter) |
| unlikePost | unlike a post | id ← feed/getPost mid | ok | CAUTION: reverses likePost (adapter) |
| unfollowUser | unfollow a user | friend_uid ← getPost user.id | ok | CAUTION: reverses followUser (adapter) |
| unbookmarkPost | remove bookmark | id ← feed/getPost mid | ok | CAUTION: reverses bookmarkPost (adapter) |

## Quick Start

```bash
# Get trending topics
openweb weibo exec getHotSearch '{}'

# Get home feed
openweb weibo exec getFriendsFeed '{"list_id": "my_follow_all", "count": 25}'

# Get hot/trending feed
openweb weibo exec getHotFeed '{"group_id": 102803, "containerid": 102803, "count": 10, "extparam": "discover|new_feed"}'

# Get a user's profile
openweb weibo exec getUserProfile '{"uid": 1918530507}'

# Get a user's posts
openweb weibo exec getUserStatuses '{"uid": 1706699904, "page": 1}'

# Get a specific post
openweb weibo exec getPost '{"id": "Qyj0ifs0m"}'

# Get reposts of a post
openweb weibo exec listReposts '{"id": 5281762063682574, "page": 1, "count": 10}'
```
