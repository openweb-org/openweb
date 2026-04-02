# Bluesky

## Overview
Bluesky AT Protocol social network — decentralized microblogging. Public read API at `public.api.bsky.app`.

## Workflows

### Browse a user's profile and posts
1. `getProfile(actor)` → display name, bio, follower counts
2. `getAuthorFeed(actor)` → user's posts → `post.uri`
3. `getPostThread(uri)` → full post with reply thread

### Search and explore
1. `searchActors(q)` → find users → `actor.handle`
2. `getProfile(handle)` → full profile for a user
3. `searchPosts(q)` → find posts (requires auth)

### Feed consumption
1. `getFeed(feed)` → discover/trending posts → `post.uri`
2. `getPostThread(uri)` → expand post with replies

### Social graph
1. `getFollowers(actor)` → who follows a user
2. `getFollows(actor)` → who a user follows

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getProfile | user profile | `actor` (handle or DID) | did, handle, displayName, bio, follower/following/post counts | entry point |
| getAuthorFeed | user's posts | `actor` ← getProfile | feed[].post (uri, text, author, embeds, counts) | cursor pagination |
| getPostThread | post with replies | `uri` ← getAuthorFeed/getFeed | thread.post, thread.replies[] | depth param controls reply depth |
| getFeed | custom feed | `feed` (AT URI of feed generator) | feed[].post | cursor pagination, use known feed URIs |
| searchPosts | search posts | `q` | posts[], hitsTotal | auth via bsky.social (localStorage_jwt) |
| searchActors | search users | `q` | actors[] with profile info | cursor pagination |
| getFollowers | user's followers | `actor` ← getProfile | followers[] profiles | cursor pagination |
| getFollows | user follows | `actor` ← getProfile | follows[] profiles | cursor pagination |
| getPosts | batch fetch posts | `uris[]` ← getAuthorFeed/getFeed | posts[] | max 25 URIs |

## Quick Start

```bash
# Get a user profile
openweb bluesky exec getProfile '{"actor": "bsky.app"}'

# Get a user's posts
openweb bluesky exec getAuthorFeed '{"actor": "bsky.app", "limit": 10}'

# View a post thread (use uri from getAuthorFeed)
openweb bluesky exec getPostThread '{"uri": "at://did:plc:.../app.bsky.feed.post/...", "depth": 6}'

# Browse a trending feed
openweb bluesky exec getFeed '{"feed": "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot", "limit": 10}'

# Search users
openweb bluesky exec searchActors '{"q": "developer", "limit": 10}'
```

---

## Site Internals

## API Architecture
- AT Protocol XRPC at `public.api.bsky.app/xrpc/` — method names are reverse-domain (e.g. `app.bsky.feed.getPostThread`)
- All endpoints are GET with query parameters
- Cursor-based pagination: response returns `cursor`, pass back as `cursor` query param
- AT URIs format: `at://did:plc:<id>/app.bsky.feed.post/<rkey>`

## Auth
No auth required for most read operations on public.api.bsky.app. `searchPosts` uses per-operation server override to `bsky.social/xrpc` with `localStorage_jwt` auth (key: `BSKY_STORAGE`, path: `session.currentAccount.accessJwt`). Requires browser sign-in to bsky.app.

## Transport
`node` — direct HTTP. No bot detection on the public API. `searchPosts` uses node+browser (browser for JWT extraction only).

## Known Issues
- `getNotifications` not included — requires auth, not available on public API
- Compiler path normalization merges all XRPC methods into `/xrpc/{param}` — manual curation required for AT Protocol sites
