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

### Like a post
1. `likePost(id)` → status confirmation
   - `id` is the numeric PK from `getFeed` or `getUserPosts` items (`items[].pk`)

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
| likePost | like a post | id (numeric PK) ← getFeed items[].pk | status | write op; requires CSRF |
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

# Like a post (write operation)
openweb instagram exec likePost '{"id":"3865890235180097425"}'

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
- `getUserPosts`: adapter (`instagram-api`) composes profile lookup + feed fetch in browser context via `pageFetch`
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
- `likePost` is a write operation — verify skips it by default
