# Weibo

## Overview
Chinese microblogging platform (social media). China's Twitter/X equivalent with trending topics, user timelines, post detail/comments, and write operations (like, repost, follow, bookmark).

## Workflows

### Browse trending and read a post
1. `getHotSearch` → pick topic → `word`
2. `getHotFeed(group_id, containerid, extparam)` → pick post → `mid`
3. `getPost(id=mid)` → full post with text, images, engagement

### Explore a user's profile and posts
1. `getUserProfile(uid)` → screen name, bio, followers, verification
2. `getUserDetail(uid)` → birthday, location, creation date
3. `getUserStatuses(uid, page)` → paginated post list → `mid`
4. `getPost(id=mid)` → full post detail

### Read home feed and interact (paired writes)
1. `getHotFeed(group_id, containerid, extparam)` → pick post → `mid` (numeric long)
2. `likePost(id=mid)` ⇄ `unlikePost(id=mid)`
3. `bookmarkPost(id=mid)` ⇄ `unbookmarkPost(id=mid)`
4. `repost(id=mid, reason)` (no inverse exposed)

### Follow / unfollow a user
1. Feed or `getPost` → `user.id`
2. `followUser(friend_uid=user.id)` ⇄ `unfollowUser(uid=user.id)` — note asymmetric param names

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getFriendsFeed | home feed | list_id | statuses[], since_id | entry point; paginate via since_id |
| getHotFeed | trending feed | group_id, containerid, extparam | statuses[], total_number | entry point; 102803 = default hot |
| getHotSearch | trending topics | — | realtime[].word, num, icon_desc | entry point; top 50 |
| getUserProfile | user profile | uid | user.screen_name, followers_count, verified | entry point (with known uid) |
| getUserDetail | user extended info | uid ← getUserProfile | ip_location, created_at, birthday | |
| getUserStatuses | user's posts | uid ← getUserProfile, page | list[], total | page-based pagination |
| getPost | post detail | id ← feed/statuses mid | text_raw, reposts_count, comments_count, attitudes_count, user, pic_infos | |
| getLongtext | full text for truncated post | id ← getPost (when isLongText=true) | longTextContent, longTextContent_raw | |
| listReposts | post reposts | id ← getPost id (numeric) | data[], total_number | page-based |
| likePost | like a post | id ← getPost mid | ok, attitude | SAFE: reversible |
| repost | repost/retweet | id ← getPost mid, reason | ok, statuses | SAFE: reversible |
| followUser | follow a user | friend_uid ← getPost user.id | id, screen_name, ok | SAFE: reversible via unfollowUser |
| bookmarkPost | bookmark a post | id ← getPost mid | status (post obj, favorited:true) | SAFE: reversible |
| unlikePost | unlike a post | id ← getPost mid | ok | CAUTION: reverses likePost |
| unfollowUser | unfollow a user | uid ← user.id | id, screen_name, ok | CAUTION: param `uid` (not `friend_uid`); endpoint typo `destory` |
| unbookmarkPost | remove bookmark | id ← getPost mid | status (post obj, favorited:false) | CAUTION: endpoint typo `destoryFavorites` |

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

---

## Site Internals

## API Architecture
- REST JSON APIs under `weibo.com/ajax/*`
- Response format: `{ok: 1, data: {...}}` wrapper for most ops; `getPost` returns WeiboPost directly
- Post IDs: alphanumeric `mblogid` (e.g. `Qyj0ifs0m`) for `getPost`/`getLongtext`; numeric `id` for `listReposts`
- User IDs: numeric integers
- Pagination: cursor-based (`since_id`/`max_id`) for feeds; page-based for user timeline and reposts

## Auth
- Type: `cookie_session` — `SUB` cookie for session
- CSRF: `cookie_to_header` — `XSRF-TOKEN` cookie → `x-xsrf-token` header
- Login required for all operations
- XSRF tokens rotate on every response — runtime uses fresh tokens from browser context

## Transport
- All ops use declarative `transport: page` (browser_fetch) — runtime issues `window.fetch` from the live weibo.com tab so `Origin: https://weibo.com` and `Referer` flow naturally and weibo's CSRF accepts the request.
- Node transport is blocked by anti-bot (returns 403)
- Requires managed browser with an open weibo.com tab
- CSRF resolved declaratively via `cookie_to_header` (XSRF-TOKEN → x-xsrf-token).

## Known Issues
- **Login required** — all ops need an active Weibo session (SUB cookie)
- **Anti-bot detection** — node HTTP always returns 403; must use page transport
- **Rate limiting** — aggressive limits on feed/search APIs; may return 418 or empty data
- **CSRF rotation** — XSRF-TOKEN rotates every response; runtime resolves a fresh token from the browser cookie before each call.
- **Long text truncation** — posts over ~140 chars truncated; use `isGetLongText=true` in getPost or getLongtext
- **listReposts empty** — may return empty data array with "前方拥堵" tip when rate-limited or session weak
- **listComments missing** — comments endpoint (`/ajax/comment/buildComments`) not yet compiled; DOC workflows reference it but op not in spec
- **Write ops are form-encoded, not JSON** — `/ajax/statuses/setLike`, `/ajax/statuses/destroyLike`, `/ajax/favorites/create`, `/ajax/friendships/create` all reject `application/json` ("parameter (id) value invalid"). The spec sends `application/x-www-form-urlencoded` for every write op except `repost` (which uses JSON). New write ops should mirror this convention unless HAR proves otherwise.
- **Write ops want numeric long `mid`, not `mblogid`** — `setLike` and friends accept only the long-integer `mid` (e.g. `5289345339621625`) from feed responses. The alphanumeric `mblogid` (e.g. `Qyj0ifs0m`) used by `getPost` is rejected. This is per-endpoint upstream behavior; the runtime cannot translate between forms.
- **Upstream typo: `destory` (not `destroy`)** — `unbookmarkPost` POSTs to `/ajax/statuses/destoryFavorites` and `unfollowUser` POSTs to `/ajax/friendships/destory`. Both endpoint names are misspelled upstream; the "correct" `destroy` spelling returns HTML 404. Discovered (2026-04-19) by greping the loaded `weibo-pro-next/index-*.js` bundle for `/ajax/` paths after probing 8 reasonable variants returned 404. Param names are also asymmetric across the create/destory pair: followUser takes `friend_uid`, unfollowUser takes `uid`; bookmark and unbookmark both take `id` (the post mid).
- **JS-bundle endpoint discovery** — when probing alleged renames returns nothing, fetch each `<script src>` from a logged-in page and grep the source for `/ajax/[\w/]+` (especially around action verbs: destroy, cancel, remove, unfollow). Cheap, deterministic, and reveals the actual paths the SPA calls — including typos and dead/legacy routes.
