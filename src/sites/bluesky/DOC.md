# Bluesky

## Overview
Bluesky AT Protocol API — decentralized social network.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getTimeline | authenticated user's feed | GET /app.bsky.feed.getTimeline | cursor pagination |
| getProfile | user profile by handle/DID | GET /app.bsky.actor.getProfile | `actor` param |
| searchActors | search users | GET /app.bsky.actor.searchActors | cursor pagination |

## API Architecture
- AT Protocol XRPC at `bsky.social/xrpc` — method names are reverse-domain (e.g. `app.bsky.feed.getTimeline`)
- Cursor-based pagination: response returns `cursor`, pass back as `cursor` query param

## Auth
- `localStorage_jwt` — reads JWT from `BSKY_STORAGE` → `session.currentAccount.accessJwt`
- Injected as `Authorization: Bearer <token>`

## Transport
- `node` — direct HTTP
