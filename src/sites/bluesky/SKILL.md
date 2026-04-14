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

### Engage with a post
1. `getAuthorFeed(actor)` or `getFeed(feed)` → find post → `uri`, `cid`
2. `likePost(uri, cid)` → like record `uri`
3. `repost(uri, cid)` → repost record `uri`
4. Reply: `getPostThread(uri)` → parent `uri`, `cid`; thread root → `rootUri`, `rootCid`
5. `createPost(text, replyTo={uri, cid, rootUri, rootCid})` → reply `uri`, `cid`

### Undo engagement
1. `getAuthorFeed(actor)` or `getPostThread(uri)` → post with `viewer.like`, `viewer.repost`
2. `unlikePost(uri=viewer.like)` → removes like
3. `unrepost(uri=viewer.repost)` → removes repost
4. `deletePost(uri)` → deletes own post (`uri` ← getAuthorFeed)

### Manage follows, blocks, and mutes
1. `getProfile(actor)` → `did`, `viewer.following`, `viewer.blocking`, `viewer.muted`
2. `follow(subject=did)` → follow record `uri`
3. `unfollow(uri=viewer.following)` → removes follow
4. `blockUser(subject=did)` → block record `uri`
5. `unblockUser(uri=viewer.blocking)` → removes block
6. `muteUser(actor)` / `unmuteUser(actor)` → toggle mute (uses handle or DID directly)

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
| createPost | publish post | `text`, `replyTo` ← getPostThread (`uri`, `cid`, `rootUri`, `rootCid`), `langs` | uri, cid | auth required, write; replyTo optional |
| deletePost | delete post | `uri` ← createPost/getAuthorFeed | success | auth required, write |
| likePost | like post | `uri`, `cid` ← getAuthorFeed/getFeed/getPostThread | like record uri, cid | auth required, write |
| unlikePost | unlike post | `uri` ← post `viewer.like` | success | auth required, write |
| repost | repost | `uri`, `cid` ← getAuthorFeed/getFeed/getPostThread | repost record uri, cid | auth required, write |
| unrepost | undo repost | `uri` ← post `viewer.repost` | success | auth required, write |
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
