# X (Twitter)

## Overview
X (Twitter) API v1.1 — social media platform. Page-transport with multi-layer auth.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| listFollowing | accounts user follows | GET /friends/list.json | cursor pagination |
| listFollowers | user's followers | GET /followers/list.json | cursor pagination |

## API Architecture
- API v1.1 at `x.com/i/api/1.1/`
- Cursor pagination: response `next_cursor_str` → request `cursor` param, items in `users` array
- `.json` suffix on paths

## Auth
- `cookie_session` — browser session cookies
- CSRF: `cookie_to_header` — reads `ct0` cookie, sends as `x-csrf-token` header on **all methods** (including GET)
- **Static bearer token**: fixed `Authorization: Bearer AAAA...` header (X web app constant)
- Additional headers: `x-twitter-auth-type: OAuth2Session`, `x-twitter-active-user: yes`

## Transport
- `page` — requires X/Twitter loaded in browser

## Known Issues
- CSRF token required on GET requests (unusual — most sites only require on mutating methods)
