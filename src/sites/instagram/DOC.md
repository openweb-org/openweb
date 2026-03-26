# Instagram

## Overview
Instagram private API v1 — social media / photo sharing.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getTimeline | authenticated user's feed | GET /feed/timeline/ | cursor pagination via `max_id` |
| getUserProfile | user profile by ID | GET /users/{user_id}/info/ | numeric user ID |
| likeMedia | like a post | POST /media/{media_id}/like/ | write op, unverified |

## API Architecture
- Private API v1 at `www.instagram.com/api/v1/`
- All requests require `X-IG-App-ID: 936619743392459` header (constant)
- Cursor pagination: response returns `next_max_id`, pass as `max_id` query param

## Auth
- `cookie_session` — uses browser session cookies
- CSRF: `cookie_to_header` — reads `csrftoken` cookie, sends as `X-CSRFToken` header

## Transport
- `node` — direct HTTP

## Dependencies
- `getTimeline` feeds user IDs into `getUserProfile`
