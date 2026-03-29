# Instagram

## Overview
Social media platform (Meta). Photo/video sharing, stories, reels, explore feed.

## Quick Start

```bash
# Search users/hashtags/places
openweb instagram exec searchTopSearch '{"query": "nature", "context": "blended"}'

# Get user profile by username
openweb instagram exec getUserProfile '{"username": "natgeo"}'

# Get user profile by numeric ID
openweb instagram exec getUserById '{"userId": "787132"}'

# Get user's posts (use userId from profile)
openweb instagram exec getUserFeed '{"userId": "787132", "count": 12}'

# Get media details
openweb instagram exec getMediaInfo '{"mediaId": "3854796740277763042"}'

# Get comments on a post
openweb instagram exec getMediaComments '{"mediaId": "3854796740277763042"}'

# Get home timeline (authenticated)
openweb instagram exec getTimeline '{}'

# Get stories tray
openweb instagram exec getReelsTray '{}'

# Get user's stories
openweb instagram exec getUserStories '{"userId": "787132"}'
```

## Operations

| Operation | Intent | Method | Safety | Notes |
|-----------|--------|--------|--------|-------|
| searchTopSearch | Search users/hashtags/places by keyword | GET | read | Returns users, hashtags, places |
| getUserProfile | Get user profile by username | GET | read | Returns bio, followers, media count |
| getUserById | Get user profile by numeric ID | GET | read | Use when you have userId but not username |
| getTimeline | Get authenticated user's home feed | GET | read | Paginated via max_id cursor |
| getUserFeed | Get user's posts feed | GET | read | Paginated via max_id cursor |
| getMediaInfo | Get detailed media post info | GET | read | Returns full media details |
| getMediaComments | Get comments on a post | GET | read | Threaded comments, paginated |
| getReelsTray | Get stories tray for followed users | GET | read | List of active story reels |
| getUserStories | Get a user's active stories | GET | read | Story items with media URLs |
| likeMedia | Like a post | POST | SAFE write | Reversible via unlikeMedia |
| unlikeMedia | Unlike a post | POST | SAFE write | Reverses likeMedia |
| saveMedia | Bookmark a post | POST | SAFE write | Reversible via unsaveMedia |
| unsaveMedia | Remove bookmark | POST | SAFE write | Reverses saveMedia |
| followUser | Follow a user | POST | SAFE write | Reversible via unfollowUser |
| unfollowUser | Unfollow a user | POST | SAFE write | Reverses followUser |

## Operation Dependencies

```
searchTopSearch → getUserProfile → getUserById
                                 → getUserFeed → getMediaInfo
                                               → getMediaComments
                                 → getUserStories
getTimeline → getUserProfile, getMediaInfo, getMediaComments
getReelsTray → getUserStories
```

## API Architecture
- REST API at `https://www.instagram.com/api/v1/`
- Also has GraphQL endpoints at `/graphql/query` and `/api/graphql` (not yet covered)
- All API calls require `x-ig-app-id: 936619743392459` header (constant)
- Responses are JSON with `status: "ok"` on success

## Auth
- Type: `cookie_session` with CSRF (`cookie_to_header`)
- CSRF: `csrftoken` cookie → `x-csrftoken` header
- CSRF required on all write operations (POST)
- Login required — unauthenticated requests return 400/401

## Transport
- **`page`** — Meta's bot detection blocks node transport
- Browser must have Instagram loaded and be logged in
- `page.evaluate(fetch(...))` with `credentials: 'include'` for cookie auth
- CDP capture must be on the same target (doesn't intercept fetch from tabs created after capture starts)

## Known Issues
- Heavy bot detection — `node` transport does not work, must use `page`
- `x-ig-app-id` header required on most endpoints (hardcoded constant `936619743392459`)
- GraphQL endpoints not yet sub-clustered — single `/api/graphql` handles many ops via `doc_id` discriminator
- Rate limiting may apply after many rapid requests
- Two profile endpoints: `getUserProfile` (by username, web_profile_info) and `getUserById` (by numeric ID, users/{id}/info) — use whichever matches your input
