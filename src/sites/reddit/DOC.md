# Reddit

## Overview
Social media platform — forum-style communities (subreddits) with threaded comments. Uses Reddit's public JSON API (append `.json` to any URL).

## Quick Start

```bash
# Search posts
openweb reddit exec searchPosts '{"q": "typescript", "limit": 5}'

# Get subreddit posts
openweb reddit exec getSubredditPosts '{"subreddit": "technology", "limit": 10}'

# Get subreddit info
openweb reddit exec getSubredditAbout '{"subreddit": "programming"}'

# Get top posts from subreddit
openweb reddit exec getSubredditSorted '{"subreddit": "technology", "sort": "top", "t": "day", "limit": 5}'

# Get user profile
openweb reddit exec getUserAbout '{"username": "spez"}'

# Get user's posts
openweb reddit exec getUserSubmitted '{"username": "spez", "limit": 5}'

# Get user's comments
openweb reddit exec getUserComments '{"username": "spez", "limit": 5}'

# Get homepage feed
openweb reddit exec getHomeFeed '{"limit": 10}'
```

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getHomeFeed | Browse popular posts | GET /.json | Paginate with `after` param |
| getSubredditPosts | Browse a subreddit | GET /r/{subreddit}.json | Default sort: hot |
| getSubredditSorted | Sort subreddit posts | GET /r/{subreddit}/{sort}.json | hot/new/top/rising, `t` for time range |
| getSubredditAbout | Subreddit metadata | GET /r/{subreddit}/about.json | subscribers, description, rules |
| searchPosts | Search by keyword | GET /search.json | Supports type, sort, time filters |
| getUserAbout | User profile | GET /user/{username}/about.json | karma, account age, verified status |
| getUserSubmitted | User's posts | GET /user/{username}/submitted.json | Paginated, sortable |
| getUserComments | User's comments | GET /user/{username}/comments.json | Paginated, sortable |

## API Architecture
Reddit exposes a public JSON API by appending `.json` to any standard URL path. This is separate from the authenticated OAuth API on `oauth.reddit.com`. The JSON API returns Reddit's standard `Listing` wrapper with `kind`, `data.after`, `data.children[]` structure.

- All responses are JSON `Listing` objects with cursor pagination (`after`/`before` fullnames)
- Posts are `t3` kind, comments are `t1`, subreddits `t5`, users `t2`
- The modern frontend (shreddit) uses SSR and does not expose these API calls in browser traffic — must navigate to `.json` URLs directly

## Auth
- **No auth required** — all operations work without cookies or tokens
- The pipeline detected `cookie_session` from browser cookies present during capture, but all endpoints verified successfully without auth
- Authenticated requests to `oauth.reddit.com` would unlock additional endpoints (e.g. voting, commenting, user settings) but are out of scope for this read-only package

## Transport
- **node** — all operations work with plain HTTP fetch, no browser needed
- No bot detection on the JSON API (Cloudflare may rate-limit heavy use)

## Known Issues
- **Rate limiting**: Reddit applies rate limits (~100 requests/minute for unauthenticated). Excessive use may trigger 429 responses.
- **`.json` API stability**: This is an older API surface. Reddit's primary API is the OAuth-authenticated `oauth.reddit.com`. The `.json` suffix API could be deprecated, though it has existed for 15+ years.
- **No post detail with comments**: The JSON API can return post+comments at `/r/{sub}/comments/{id}.json` but this requires a specific post ID from browsing, which would need a two-step flow (list → detail). Not included in initial package.
