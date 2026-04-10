# Instagram

## Overview
Social media platform (Meta). Photo/video sharing, stories, reels.

## Workflows

### Look up a user profile
1. `getUserProfile(username)` → user info with `id`, bio, follower/following counts

### Browse a user's posts (by username)
1. `getUserPosts(username, count)` → posts with `pk`, `code`, captions, like counts, user info
2. `getUserPosts(username, count, max_id)` → next page (cursor from `next_max_id`)

### Browse a user's posts (by ID)
1. `getUserProfile(username)` → `id`
2. `getFeed(id, count)` → posts with `pk`, `code`, captions, like counts
3. `getFeed(id, count, max_id)` → next page (cursor from `next_max_id`)

### View post comments
1. `getPostComments(id)` → comments with text, author info, like counts
   - `id` is the numeric PK from `getFeed` or `getUserPosts` items (`items[].pk`)
2. `getPostComments(id, min_id)` → next page (cursor from `next_min_id`)

### View a specific post
1. `getPost(id)` → media detail with caption, likes, comments, media URLs
   - `id` is the numeric PK from `getFeed` items (`items[].pk`)

### View a user's stories
1. `getUserProfile(username)` → `id`
2. `getStories(id)` → current stories via `reel` object (null if no active stories)

### Like / unlike a post
1. `likePost(id)` → status confirmation
2. `unlikePost(id)` → status confirmation
   - `id` is the numeric PK from `getFeed` or `getUserPosts` items (`items[].pk`)

### Follow / unfollow a user
1. `getUserProfile(username)` → `id`
2. `followUser(id)` → friendship_status (following/outgoing_request)
3. `unfollowUser(id)` → friendship_status

### Save / unsave a post
1. `savePost(id)` → status confirmation
2. `unsavePost(id)` → status confirmation

### Comment on a post
1. `createComment(id, comment_text)` → created comment with pk, text, user
2. `deleteComment(media_id, comment_id)` → status confirmation
   - `comment_id` from `getPostComments` comments[].pk

### Block / unblock a user
1. `getUserProfile(username)` → `id`
2. `blockUser(id)` → friendship_status (blocking)
3. `unblockUser(id)` → friendship_status

### Mute / unmute a user
1. `getUserProfile(username)` → `id`
2. `muteUser(id)` → status confirmation (hides posts + stories)
3. `unmuteUser(id)` → status confirmation

### Browse Explore page
1. `getExplore()` → trending posts grid
2. `getExplore(max_id)` → next page

### View followers / following
1. `getUserProfile(username)` → `id`
2. `getFollowers(id, count)` → follower list with usernames, verification status
3. `getFollowing(id, count)` → following list

### View a user's Reels
1. `getUserProfile(username)` → `id`
2. `getReels(id, count)` → reels with play counts, captions

### View notifications
1. `getNotifications()` → activity feed (likes, comments, follows, mentions)

### Search for users
1. `searchUsers(query)` → user list with usernames, full names, verification status

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getUserProfile | view user profile | username | id, biography, follower/following counts, is_verified | entry point |
| getUserPosts | browse posts by username | username | posts with pk, code, caption, like_count, user info | adapter; paginated via next_max_id |
| getPost | view post detail | id (numeric PK) ← getFeed items[].pk | caption, like_count, comment_count, media URLs | — |
| getFeed | browse user posts by ID | id (user ID) ← getUserProfile data.user.id | posts with pk, code, caption, like_count | paginated via next_max_id |
| getPostComments | view post comments | id (numeric PK) ← getFeed items[].pk | comments with text, author, like counts | paginated via next_min_id |
| getStories | view user stories | id (user ID) ← getUserProfile data.user.id | reel with story items, media URLs, expiration times | null reel if no active stories |
| likePost | like a post | id (numeric PK) ← getFeed items[].pk | status | write; CSRF |
| unlikePost | unlike a post | id (numeric PK) ← getFeed items[].pk | status | write; CSRF |
| followUser | follow a user | id (user ID) ← getUserProfile data.user.id | friendship_status | write; CSRF |
| unfollowUser | unfollow a user | id (user ID) ← getUserProfile data.user.id | friendship_status | write; CSRF |
| savePost | bookmark a post | id (numeric PK) ← getFeed items[].pk | status | write; CSRF |
| unsavePost | remove bookmark | id (numeric PK) ← getFeed items[].pk | status | write; CSRF |
| createComment | add comment | id (numeric PK), comment_text | comment with pk, text, user | write; CSRF; requestBody |
| deleteComment | remove comment | media_id, comment_id ← getPostComments comments[].pk | status | write; CSRF |
| blockUser | block a user | id (user ID) ← getUserProfile data.user.id | friendship_status | write; CSRF |
| unblockUser | unblock a user | id (user ID) ← getUserProfile data.user.id | friendship_status | write; CSRF |
| muteUser | mute a user | id (user ID) ← getUserProfile data.user.id | status | write; CSRF; adapter |
| unmuteUser | unmute a user | id (user ID) ← getUserProfile data.user.id | status | write; CSRF; adapter |
| getExplore | browse explore page | (none) | sectional_items with media grid | paginated via next_max_id |
| getFollowers | list followers | id (user ID) ← getUserProfile data.user.id | users with username, is_verified | paginated via next_max_id |
| getFollowing | list following | id (user ID) ← getUserProfile data.user.id | users with username, is_verified | paginated via next_max_id |
| getReels | view user reels | id (user ID) ← getUserProfile data.user.id | reels with play_count, captions | adapter; paginated via paging_info |
| getNotifications | activity feed | (none) | counts, new_stories, old_stories | — |
| searchUsers | find users | query (search term) | users with username, full_name, is_verified, follower_count | entry point |

## Quick Start

```bash
# Get a user profile
openweb instagram exec getUserProfile '{"username":"instagram"}'

# Get user's posts by username (adapter — resolves username automatically)
openweb instagram exec getUserPosts '{"username":"instagram","count":12}'

# Get user's feed by ID (first page)
openweb instagram exec getFeed '{"id":"25025320","count":12}'

# View a specific post (use pk from feed)
openweb instagram exec getPost '{"id":"3865890235180097425"}'

# Get comments on a post
openweb instagram exec getPostComments '{"id":"3865890235180097425"}'

# Get a user's stories
openweb instagram exec getStories '{"id":"25025320"}'

# Like / unlike a post (write operations)
openweb instagram exec likePost '{"id":"3865890235180097425"}'
openweb instagram exec unlikePost '{"id":"3865890235180097425"}'

# Follow / unfollow a user
openweb instagram exec followUser '{"id":"25025320"}'
openweb instagram exec unfollowUser '{"id":"25025320"}'

# Save / unsave a post
openweb instagram exec savePost '{"id":"3865890235180097425"}'
openweb instagram exec unsavePost '{"id":"3865890235180097425"}'

# Comment on a post
openweb instagram exec createComment '{"id":"3865890235180097425","comment_text":"Great post!"}'
openweb instagram exec deleteComment '{"media_id":"3865890235180097425","comment_id":"18042648274123456"}'

# Block / unblock a user
openweb instagram exec blockUser '{"id":"25025320"}'
openweb instagram exec unblockUser '{"id":"25025320"}'

# Mute / unmute a user (adapter — routes to correct endpoint)
openweb instagram exec muteUser '{"id":"25025320"}'
openweb instagram exec unmuteUser '{"id":"25025320"}'

# Browse Explore page
openweb instagram exec getExplore '{}'

# Get followers / following
openweb instagram exec getFollowers '{"id":"25025320","count":12}'
openweb instagram exec getFollowing '{"id":"25025320","count":12}'

# Get a user's Reels (adapter — POST to clips endpoint)
openweb instagram exec getReels '{"id":"25025320","count":12}'

# Get notifications
openweb instagram exec getNotifications '{}'

# Search users
openweb instagram exec searchUsers '{"query":"nasa"}'
```

---

## Site Internals

### API Architecture
- REST API v1 at `https://www.instagram.com/api/v1/`
- Search at `https://www.instagram.com/web/search/topsearch/`
- Also has GraphQL at `/graphql/query/` and `/api/graphql` (not used in this package)
- All JSON responses

### Auth
- `cookie_session` — session cookies from logged-in browser (`sessionid`, `ds_user_id`, `csrftoken`)
- CSRF: `csrftoken` cookie → `x-csrftoken` header (POST/PUT/DELETE only)
- Additional headers sent automatically: `x-ig-app-id`, `x-ig-www-claim`

### Transport
- `page` — Meta bot detection blocks direct node HTTP requests
- Non-adapter ops: requests execute via page transport (browser-context fetch)
- Adapter ops: `getUserPosts` composes profile + feed; `muteUser`/`unmuteUser` route to mute endpoint; `getReels` POSTs to clips endpoint
- Page URL: `https://www.instagram.com/`

### Known Issues
- Meta bot detection: aggressive TLS fingerprinting, blocks all non-browser requests
- Rate limiting on API endpoints — avoid rapid sequential calls
- Requires logged-in session for all API endpoints
- Media PK is a large numeric string, not the URL shortcode
- GraphQL doc_id hashes change frequently — REST v1 endpoints are more stable
- `searchUsers` `places` and `hashtags` arrays return empty — bare `type: object` item schemas cannot be enriched
- `getStories` returns `reel: null` if user has no active stories
- `getPostComments` `user.pk` is mixed type — integer for older accounts, string for newer ones
- Write operations are skipped by verify by default
- `muteUser`/`unmuteUser` use internal mute_posts_or_story_from_follow endpoint (mutes both posts and stories)
- `getReels` uses POST to `/api/v1/clips/user/` internally (adapter handles this)
