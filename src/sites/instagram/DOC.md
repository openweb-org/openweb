# Instagram

## Overview
Social media platform (Meta). Photo/video sharing, stories, reels.

## Workflows

### Look up a user profile
1. `getUserProfile(username)` → user info with `id`, bio, follower/following counts

### Browse a user's posts
1. `getUserProfile(username)` → `id`
2. `getFeed(id, count)` → posts with `pk`, `code`, captions, like counts
3. `getFeed(id, count, max_id)` → next page (cursor from `next_max_id`)

### View a specific post
1. `getPost(id)` → media detail with caption, likes, comments, media URLs
   - `id` is the numeric PK from `getFeed` items (`items[].pk`)

### Search for users
1. `searchUsers(query)` → user list with usernames, full names, verification status

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getUserProfile | view user profile | username | id, biography, follower/following counts, is_verified | entry point |
| getPost | view post detail | id (numeric PK) ← getFeed items[].pk | caption, like_count, comment_count, media URLs | — |
| getFeed | browse user posts | id (user ID) ← getUserProfile data.user.id | posts with pk, code, caption, like_count | paginated via next_max_id |
| searchUsers | find users | query (search term) | users with username, full_name, is_verified, follower_count | entry point |

## Quick Start

```bash
# Get a user profile
openweb instagram exec getUserProfile '{"username":"instagram"}'

# Get user's feed (first page)
openweb instagram exec getFeed '{"id":"25025320","count":12}'

# View a specific post (use pk from feed)
openweb instagram exec getPost '{"id":"3865890235180097425"}'

# Search users
openweb instagram exec searchUsers '{"query":"nasa"}'
```

---

## Site Internals

## API Architecture
- REST API v1 at `https://www.instagram.com/api/v1/`
- Search at `https://www.instagram.com/web/search/topsearch/`
- Also has GraphQL at `/graphql/query/` and `/api/graphql` (not used in this package)
- All JSON responses

## Auth
- `cookie_session` — session cookies from logged-in browser (`sessionid`, `ds_user_id`, `csrftoken`)
- CSRF: `csrftoken` cookie → `x-csrftoken` header (POST/PUT/DELETE only)
- Additional headers sent automatically: `x-ig-app-id`, `x-ig-www-claim`

## Transport
- `page` — Meta bot detection blocks direct node HTTP requests
- Requests execute via `page.evaluate(fetch(...))` in the browser tab
- Page URL: `https://www.instagram.com/`

## Known Issues
- Meta bot detection: aggressive TLS fingerprinting, blocks all non-browser requests
- Rate limiting on API endpoints — avoid rapid sequential calls
- Requires logged-in session for all API endpoints
- Media PK is a large numeric string, not the URL shortcode
- GraphQL doc_id hashes change frequently — REST v1 endpoints are more stable
