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

### Read home feed and interact (verified write ops, paired)
1. `getHotFeed(group_id, containerid, extparam)` → pick post → `statuses[].mid` (numeric long), `statuses[].user.id`
2. `likePost(id ← statuses[].mid)` → `ok`, `attitude`
3. `unlikePost(id ← statuses[].mid)` → `ok` (reverses likePost)
4. `bookmarkPost(id ← statuses[].mid)` → `ok`, `favorited_time`
5. `unbookmarkPost(id ← statuses[].mid)` → `ok` (reverses bookmarkPost; note upstream typo `destory`)
6. `repost(id ← statuses[].mid, reason)` → `ok`, `statuses` (publish a quote-repost)

> **`mid` format matters.** Write ops require the **numeric long-integer `mid`**
> (e.g. `5289345339621625`) from feed responses, **not** the alphanumeric
> `mblogid` (e.g. `Qyj0ifs0m`) used by `getPost`. setLike/destoryFavorites accept
> only the long integer.

### Follow / unfollow a user from a post
1. `getPost(id)` or feed → `user.id`
2. `followUser(friend_uid ← user.id)` → returns target user object
3. `unfollowUser(uid ← user.id)` → reverses followUser (note: param is `uid`, not `friend_uid`; endpoint typo `destory`)

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
| likePost | like a post | id ← feed/getPost mid (numeric long) | ok, attitude | SAFE: reversible via unlikePost |
| repost | repost/retweet | id ← feed mid, reason | ok, statuses | SAFE: reversible via deletePost (not exposed) |
| followUser | follow a user | friend_uid ← user.id | id, screen_name, ok | SAFE: reversible via unfollowUser |
| bookmarkPost | bookmark a post | id ← feed mid | status (post obj) | SAFE: reversible via unbookmarkPost |
| unlikePost | unlike a post | id ← feed mid | ok | CAUTION: reverses likePost |
| unfollowUser | unfollow a user | uid ← user.id | id, screen_name, ok | CAUTION: param is `uid` not `friend_uid`; endpoint typo `/friendships/destory` |
| unbookmarkPost | remove bookmark | id ← feed mid | status (post obj, favorited:false) | CAUTION: endpoint typo `/statuses/destoryFavorites` |

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

# Bookmark / unbookmark (note "destory" typo on the unbookmark endpoint)
openweb weibo exec bookmarkPost   '{"id": "5288272024575643"}'
openweb weibo exec unbookmarkPost '{"id": "5288272024575643"}'

# Follow / unfollow (note: unfollow uses `uid`, follow uses `friend_uid`)
openweb weibo exec followUser   '{"friend_uid": "6859786766"}'
openweb weibo exec unfollowUser '{"uid": "6859786766"}'

# Quote-repost
openweb weibo exec repost '{"id": "5289345339621625", "reason": "interesting"}'
```

## Known Limitations
- **Login required** — every op needs a logged-in `weibo.com` browser tab (SUB cookie).
- **Numeric long `mid` for write ops** — likePost/unlikePost/bookmarkPost/unbookmarkPost/repost reject the alphanumeric `mblogid`. Read `mid` from feed responses (`getFriendsFeed.statuses[].mid`, `getHotFeed.statuses[].mid`), not from `getPost`.
- **Upstream typos: `destory` (not `destroy`)** — `unbookmarkPost` POSTs to `/ajax/statuses/destoryFavorites` and `unfollowUser` POSTs to `/ajax/friendships/destory`. Both spellings are wrong (Weibo's typo); using the "correct" `destroy` returns HTML 404. Param name is also asymmetric — followUser takes `friend_uid`, unfollowUser takes `uid`.
