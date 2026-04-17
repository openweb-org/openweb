# Bluesky

## Overview
Bluesky AT Protocol social network — decentralized microblogging. Public read API at `public.api.bsky.app`, write ops via user's PDS (Personal Data Server).

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

### Post and engage
1. `createPost(text)` → publish a post → `uri`, `cid`
2. `likePost(uri, cid)` → like a post → like record `uri`
3. `repost(uri, cid)` → repost → repost record `uri`
4. `createPost(text, replyTo)` → reply to a post

### Undo engagement
1. `unlikePost(uri)` → undo like (use `viewer.like` from post)
2. `unrepost(uri)` → undo repost (use `viewer.repost` from post)
3. `deletePost(uri)` → delete own post

### Follow/block/mute management
1. `getProfile(actor)` → get DID
2. `follow(subject)` / `unfollow(uri)` → manage follows
3. `blockUser(subject)` / `unblockUser(uri)` → manage blocks
4. `muteUser(actor)` / `unmuteUser(actor)` → manage mutes

### Notifications
1. `getNotifications(limit)` → likes, reposts, follows, mentions, replies

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getProfile | user profile | `actor` (handle or DID) | did, handle, displayName, bio, follower/following/post counts | entry point |
| getAuthorFeed | user's posts | `actor` ← getProfile | feed[].post (uri, text, author, embeds, counts) | cursor pagination |
| getPostThread | post with replies | `uri` ← getAuthorFeed/getFeed | thread.post (text, author, embeds, like/repost/reply/quote/bookmark counts), thread.replies[] | depth param controls reply depth |
| getFeed | custom feed | `feed` (AT URI of feed generator) | feed[].post | cursor pagination, use known feed URIs |
| searchPosts | search posts | `q` | posts[], hitsTotal | auth via bsky.app (localStorage_jwt) |
| searchActors | search users | `q` | actors[] with profile info | cursor pagination |
| getFollowers | user's followers | `actor` ← getProfile | followers[] profiles | cursor pagination |
| getFollows | user follows | `actor` ← getProfile | follows[] profiles | cursor pagination |
| getPosts | batch fetch posts | `uris[]` ← getAuthorFeed/getFeed | posts[] | max 25 URIs |
| createPost | publish post | `text`, optional `replyTo`, `langs` | uri, cid | auth required, write |
| deletePost | delete post | `uri` ← createPost | success | auth required, write |
| likePost | like post | `uri`, `cid` ← feed/thread | like record uri, cid | auth required, write |
| unlikePost | unlike post | `uri` ← post viewer.like | success | auth required, write |
| repost | repost | `uri`, `cid` ← feed/thread | repost record uri, cid | auth required, write |
| unrepost | undo repost | `uri` ← post viewer.repost | success | auth required, write |
| follow | follow user | `subject` (DID) ← getProfile | follow record uri, cid | auth required, write |
| unfollow | unfollow user | `uri` ← profile viewer.following | success | auth required, write |
| blockUser | block user | `subject` (DID) ← getProfile | block record uri, cid | auth required, write |
| unblockUser | unblock user | `uri` ← profile viewer.blocking | success | auth required, write |
| muteUser | mute user | `actor` (handle or DID) | success | auth required, write |
| unmuteUser | unmute user | `actor` (handle or DID) | success | auth required, write |
| getNotifications | notifications | `limit`, `cursor` | notifications[] (reason, author, record) | auth required, cursor pagination |

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

# Create a post (requires auth)
openweb bluesky exec createPost '{"text": "Hello world!", "langs": ["en"]}'

# Like a post (requires auth, get uri/cid from feed)
openweb bluesky exec likePost '{"uri": "at://did:plc:.../app.bsky.feed.post/...", "cid": "bafyrei..."}'

# Follow a user (requires auth, get DID from getProfile)
openweb bluesky exec follow '{"subject": "did:plc:..."}'

# Get notifications (requires auth)
openweb bluesky exec getNotifications '{"limit": 10}'
```

---

## Site Internals

## API Architecture
- AT Protocol XRPC at `public.api.bsky.app/xrpc/` — method names are reverse-domain (e.g. `app.bsky.feed.getPostThread`)
- Read endpoints are GET with query parameters on public API
- Write endpoints use POST via user's PDS — all record mutations go through `com.atproto.repo.createRecord` / `deleteRecord`
- Mute/unmute use dedicated XRPC procedures (`app.bsky.graph.muteActor` / `unmuteActor`)
- Cursor-based pagination: response returns `cursor`, pass back as `cursor` query param
- AT URIs format: `at://did:plc:<id>/app.bsky.feed.post/<rkey>`

## Auth
No auth required for read operations on public.api.bsky.app. All write ops and `searchPosts`/`getNotifications` use per-operation server override to `bsky.app` with `localStorage_jwt` auth (key: `BSKY_STORAGE`, path: `session.currentAccount.accessJwt`). Requires browser sign-in to bsky.app. The adapter dynamically resolves the user's PDS URL from the session.

## Transport
`node` for public read ops — direct HTTP, no bot detection. Write ops use `page` transport — browser required for localStorage access and PDS resolution.

## Adapter Patterns
`adapters/bluesky-pds.ts` is a `CustomRunner` (`run(ctx)` shape, no `init`/`isAuthenticated`/`execute` lifecycle). Operations dispatch via an `OPERATIONS` table keyed by op name. The shared `requireSession(ctx)` helper reads the bsky.app localStorage session and throws `errors.needsLogin()` when absent — this is now the sole `needs_login` signal, replacing the old `isAuthenticated()` localStorage probe (which was redundant: pure client-side reads can't validate server state, and token errors from `pdsGet`/`pdsPost` cover expiry). No `init()` step — PagePlan handles navigation; the prior `init()` only navigated to bsky.app.

## Known Issues
- Compiler path normalization merges all XRPC methods into `/xrpc/{param}` — manual curation required for AT Protocol sites
- `searchPosts` verify DRIFT — search results contain heterogeneous embed types, causing structural fingerprint to vary across runs
- Write ops cannot be verified without an active bsky.app session — expected to be gated by permission layer
- `unlikePost` / `unrepost` / `unfollow` / `unblockUser` require the AT URI of the record to delete (available from post/profile viewer state when authenticated)
