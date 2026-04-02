# Twitch

## Overview

Live streaming platform. All public data served through a GraphQL API at `gql.twitch.tv/gql` using persisted queries (sha256 hashes). No auth needed for public reads.

## Workflows

### Find a streamer and check if they're live
1. `searchChannels(query)` → pick channel → `channelLogin` (from `login` field)
2. `getStream(channelLogin)` → stream status (null = offline)

### Browse a channel profile
1. `getChannel(channelLogin)` → description, followers, social links, partner status

### Discover popular games
1. `getTopGames(limit, sort)` → top categories with viewer/broadcaster counts

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchChannels | find channels by keyword | query | login, displayName, followers, broadcastTitle | entry point; cursor pagination |
| getChannel | channel profile | channelLogin ← searchChannels.login | displayName, followers, isPartner, socialMedias | |
| getStream | live stream status | channelLogin ← searchChannels.login | stream (null=offline), game, lastBroadcastTitle | |
| getTopGames | top categories/games | limit, sort | displayName, viewersCount, broadcastersCount, tags | entry point |

## Quick Start

```bash
# Search for channels
openweb twitch exec searchChannels '{"query":"valorant"}'

# Get channel profile
openweb twitch exec getChannel '{"channelLogin":"shroud"}'

# Check if a channel is live
openweb twitch exec getStream '{"channelLogin":"shroud"}'

# Browse top games/categories
openweb twitch exec getTopGames '{"limit":10}'
```

---

## Site Internals

## API Architecture

GraphQL API at `gql.twitch.tv/gql` with persisted queries. Each read operation uses a sha256 hash that maps to a server-side query — no inline query text accepted for reads. Requests require a public `Client-ID` header (`kimne78kx3ncx6brgo4mv6wki5h1ko`).

## Auth

No auth required for public data. Write operations (follow, etc.) would require `auth-token` cookie via OAuth.

## Transport

`page` transport — requests made via `page.evaluate(fetch)` in the browser context. Required because Twitch's GQL endpoint checks request origin and the adapter needs to run from a Twitch page.

## Known Issues

- **Persisted query hashes** are tied to Twitch's frontend version and may break on deploys. Hashes in `queries.ts` need periodic updates.
- **No viewer count on getStream** — the StreamMetadata GQL query doesn't return viewer count (that's in a separate query). Use getChannel or searchChannels for follower counts.
