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

### Read home feed and interact (verified write ops)
1. `getHotFeed(group_id, containerid, extparam)` → pick post → `statuses[].mid` (numeric long)
2. `likePost(id ← statuses[].mid)` → `ok`, `attitude` (set like)
3. `unlikePost(id ← statuses[].mid)` → `ok` (reverse the like)
4. `repost(id ← statuses[].mid, reason)` → `ok`, `statuses` (publish a quote-repost)

> **`mid` format matters.** Write ops require the **numeric long-integer `mid`**
> (e.g. `5289345339621625`) from feed responses, **not** the alphanumeric
> `mblogid` (e.g. `Qyj0ifs0m`) used by `getPost`. setLike/destroyLike accept
> only the long integer.

### Follow a user from a post (currently BLOCKED — see Known Limitations)
1. `getPost(id)` → `user.id`, `user.screen_name`
2. `followUser(friend_uid=user.id)` — endpoint returns 404 upstream

### Undo actions (partial — see Known Limitations)
1. `unlikePost(id ← feed mid)` → `ok` ✅
2. `unfollowUser(friend_uid=user.id)` — endpoint returns 404 upstream
3. `unbookmarkPost(id=mid)` — endpoint returns 404 upstream

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

# Like / unlike a post (numeric long mid, not mblogid)
openweb weibo exec likePost   '{"id": "5289345339621625"}'
openweb weibo exec unlikePost '{"id": "5289345339621625"}'

# Quote-repost
openweb weibo exec repost '{"id": "5289345339621625", "reason": "interesting"}'
```

## Known Limitations
- **Login required** — every op needs a logged-in `weibo.com` browser tab (SUB cookie).
- **Numeric long `mid` for write ops** — likePost/unlikePost/repost reject the alphanumeric `mblogid`. Read `mid` from feed responses (`getFriendsFeed.statuses[].mid`, `getHotFeed.statuses[].mid`), not from `getPost`.
- **BLOCKED ops (upstream endpoint drift, 2026-04-18):** `bookmarkPost`, `unbookmarkPost`, `followUser`, `unfollowUser`. The `/ajax/statuses/destroyFavorites` and `/ajax/friendships/destroy` endpoints now return HTTP 404 (renamed/moved upstream). Specs and adapter routes are kept in `openapi.yaml` but example fixtures were dropped — fresh HAR capture is required to repoint these to the current endpoints (see `doc/todo/write-verify/handoff.md` §3.7).
