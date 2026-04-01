# Reddit

## Overview
Social media platform — link aggregation, discussion, communities (subreddits). Social Media archetype.

## Workflows

### Browse and read a subreddit
1. `getSubredditPosts(subreddit)` → pick post → `post_id`, `subreddit`
2. `getPostComments(subreddit, post_id)` → post detail + comment tree

### Search and dive into a post
1. `searchPosts(q)` → results with `subreddit`, post `id`
2. `getPostComments(subreddit, post_id)` → full post + comments

### Investigate a user
1. `getUserProfile(username)` → karma, account age, verified status
2. `getUserPosts(username)` → recent posts and comments

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getSubredditPosts | get subreddit feed | subreddit | title, author, score, url, after | entry point; paginated |
| getPopularPosts | get trending posts | — | title, subreddit, score, url, after | entry point |
| searchPosts | search posts by keyword | q | title, subreddit, score, url | entry point; sort, time, type filters |
| getPostComments | get post + comment tree | subreddit, post_id ← getSubredditPosts | title, selftext, comment tree | returns [post, comments] array |
| getUserProfile | get user profile | username | karma, created, verified, is_gold | entry point |
| getUserPosts | get user activity | username | title, body, subreddit, score | entry point; sort: new/hot/top |
| getSubredditAbout | get subreddit metadata | subreddit | subscribers, description, active_users | entry point |
| vote | vote on post/comment | id ← getSubredditPosts | — | requires auth, write permission |
| savePost | bookmark post/comment | id ← getSubredditPosts | — | requires auth, write permission |
| getMe | authenticated user profile | — | name, karma, verified | requires auth; oauth.reddit.com |

## Quick Start

```bash
# Get subreddit posts
openweb reddit exec getSubredditPosts '{"subreddit": "programming"}'

# Search posts
openweb reddit exec searchPosts '{"q": "typescript"}'

# Get popular posts
openweb reddit exec getPopularPosts '{}'

# Get post with comments (post_id from a listing)
openweb reddit exec getPostComments '{"subreddit": "programming", "post_id": "1s5ja3a"}'

# Get user profile
openweb reddit exec getUserProfile '{"username": "spez"}'

# Get user's recent posts/comments
openweb reddit exec getUserPosts '{"username": "spez"}'

# Get subreddit metadata
openweb reddit exec getSubredditAbout '{"subreddit": "programming"}'
```

---

## Site Internals

## API Architecture
- Public read API via `www.reddit.com` — append `.json` to any Reddit URL for JSON
- Authenticated ops use `oauth.reddit.com` (getMe) or www.reddit.com with cookies (vote, savePost)
- Response structure: `{data: {children: [...], after: "t3_..."}}`
- Post comments endpoint returns an array of two Listings: [0] = post data, [1] = comment tree
- Pagination via `after` cursor parameter (fullname like `t3_1s5ja3a`)

## Auth
No auth required for public read operations (7 ops). The `.json` API works without authentication.

Write operations (`vote`, `savePost`) and `getMe` require authentication:
- `getMe` returns features config instead of user profile without auth
- `vote` and `savePost` need `write` permission + authenticated session

## Transport
Node transport — all public read operations work via direct HTTP fetch.

## Known Issues
- `vote` and `savePost` require write permission + authenticated session (unverified)
- `getMe` returns partial data without auth (features only, no user profile)
- Rate limiting may apply for high-frequency requests
- Some subreddits may be private or quarantined (returns 403/451)
- Response size can be large (100KB+ for feeds, 200KB+ for comment threads)
