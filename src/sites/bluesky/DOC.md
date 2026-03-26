# Bluesky

## Overview
Bluesky AT Protocol API — decentralized social network.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getTimeline | authenticated user's feed | GET /app.bsky.feed.getTimeline | cursor pagination, auth required |
| getProfile | user profile by handle/DID | GET /app.bsky.actor.getProfile | `actor` param |
| searchActors | search users | GET /app.bsky.actor.searchActors | cursor pagination |
| getPostThread | post with reply thread | GET /app.bsky.feed.getPostThread | `uri` param (AT URI), depth control |
| getAuthorFeed | user's posts | GET /app.bsky.feed.getAuthorFeed | `actor` param, filter types, cursor |
| getActorLikes | posts liked by user | GET /app.bsky.feed.getActorLikes | auth required, cursor pagination |
| searchPosts | search posts by keyword | GET /app.bsky.feed.searchPosts | auth required, sort/author/lang filters |
| getPosts | batch fetch posts by URI | GET /app.bsky.feed.getPosts | `uris[]` param, max 25 |
| getFollowers | user's followers | GET /app.bsky.graph.getFollowers | cursor pagination |
| getFollows | accounts user follows | GET /app.bsky.graph.getFollows | cursor pagination |
| createRecord | like/repost/follow | POST /com.atproto.repo.createRecord | ✅ SAFE (reversible), auth required |
| deleteRecord | unlike/unrepost/unfollow | POST /com.atproto.repo.deleteRecord | ✅ SAFE (reversible), auth required |

## API Architecture
- AT Protocol XRPC at `bsky.social/xrpc` — method names are reverse-domain (e.g. `app.bsky.feed.getTimeline`)
- Cursor-based pagination: response returns `cursor`, pass back as `cursor` query param
- Public read endpoints also available at `public.api.bsky.app/xrpc` without auth
- Write operations use `com.atproto.repo.createRecord/deleteRecord` with `collection` field to specify record type
  - Like: `collection: app.bsky.feed.like`, record: `{subject: {uri, cid}, createdAt}`
  - Repost: `collection: app.bsky.feed.repost`, record: `{subject: {uri, cid}, createdAt}`
  - Follow: `collection: app.bsky.graph.follow`, record: `{subject: did, createdAt}`

## Auth
- `localStorage_jwt` — reads JWT from `BSKY_STORAGE` → `session.currentAccount.accessJwt`
- Injected as `Authorization: Bearer <token>`
- Public read ops (getProfile, getPostThread, getAuthorFeed, getPosts, getFollowers, getFollows, searchActors) work without auth on public.api.bsky.app
- Auth required for: getTimeline, searchPosts, getActorLikes, createRecord, deleteRecord

## Transport
- `node` — direct HTTP

## Known Issues
- `openweb verify` hangs for this site because auth resolution via localStorage_jwt requires a browser with bsky.app open and logged in
- searchPosts returns 403 on public.api.bsky.app (auth required)
- getActorLikes requires auth even for public profiles
