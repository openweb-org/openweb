# Instagram

## Overview
Instagram private API v1 — social media / photo sharing.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getTimeline | authenticated user's feed | GET /feed/timeline/ | cursor pagination via `max_id` |
| getUserProfile | user profile by ID | GET /users/{user_id}/info/ | numeric user ID |
| getUserPosts | user's media grid | GET /feed/user/{user_id}/ | cursor pagination via `max_id` |
| getMediaInfo | post detail | GET /media/{media_id}/info/ | full media metadata |
| getMediaComments | comments on a post | GET /media/{media_id}/comments/ | threaded, cursor pagination via `min_id` |
| searchUsers | search users/hashtags/places | GET /web/search/topsearch/ | blended context by default |
| getReelsTray | stories tray for followed users | GET /feed/reels_tray/ | list of story reels |
| getUserStories | user's active stories | GET /feed/user/{user_id}/story/ | single user's stories |
| likeMedia | like a post | POST /media/{media_id}/like/ | write, safe |
| unlikeMedia | unlike a post | POST /media/{media_id}/unlike/ | write, safe |
| followUser | follow a user | POST /friendships/create/{user_id}/ | write, safe |
| bookmarkMedia | save/bookmark a post | POST /media/{media_id}/save/ | write, safe |

## API Architecture
- Private API v1 at `www.instagram.com/api/v1/`
- All requests require `X-IG-App-ID: 936619743392459` header (constant)
- Cursor pagination: response returns `next_max_id` (or `next_min_id` for comments), pass as query param
- Threaded comments via `can_support_threading=true` query param

## Auth
- `cookie_session` — uses browser session cookies
- CSRF: `cookie_to_header` — reads `csrftoken` cookie, sends as `X-CSRFToken` header

## Transport
- `node` — direct HTTP (with browser cookies extracted via CDP)

## Dependencies
- `getTimeline` → `getUserProfile`, `getMediaInfo`, `getMediaComments`
- `getUserProfile` → `getUserPosts`, `getUserStories`
- `getUserPosts` → `getMediaInfo`, `getMediaComments`
- `searchUsers` → `getUserProfile`

## Write Operation Safety
| Operation | Safety | Notes |
|-----------|--------|-------|
| likeMedia | ✅ SAFE | reversible via unlikeMedia |
| unlikeMedia | ✅ SAFE | reversible via likeMedia |
| followUser | ✅ SAFE | reversible via unfollowUser (not yet added) |
| bookmarkMedia | ✅ SAFE | reversible via unsave |
