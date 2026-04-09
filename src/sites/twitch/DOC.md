# Twitch

## Overview

Live streaming platform. All public data served through a GraphQL API at `gql.twitch.tv/gql` using persisted queries (sha256 hashes) or raw GQL queries. No auth needed for public reads.

## Workflows

### Find a streamer and check if they're live
1. `searchChannels(query)` → pick channel → `channelLogin` (from `login` field)
2. `getStream(channelLogin)` → stream status (null = offline)

### Browse a channel profile
1. `searchChannels(query)` → pick channel → `channelLogin` (from `login` field)
2. `getChannel(channelLogin)` → description, followers, social links, partner status

### Discover popular games
1. `getTopGames(limit, sort)` → top categories with viewer/broadcaster counts

### Browse top live streams
1. `getTopStreams(limit)` → top streams sorted by viewer count, with streamer and game info

### Get clips for a channel
1. `searchChannels(query)` → pick channel → `login`
2. `getClips(login, criteria)` → popular clips with view counts, durations

### Get past broadcasts for a channel
1. `searchChannels(query)` → pick channel → `login` → use as `channelOwnerLogin`
2. `getVideos(channelOwnerLogin)` → VODs, highlights, uploads with view counts

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchChannels | find channels by keyword | query | login, displayName, followers, broadcastTitle | entry point; cursor pagination |
| getChannel | channel profile | channelLogin ← searchChannels.login | displayName, followers, isPartner, socialMedias | |
| getStream | live stream status | channelLogin ← searchChannels.login | stream (null=offline), game, lastBroadcastTitle | |
| getTopGames | top categories/games | limit, sort | displayName, viewersCount, broadcastersCount, tags | entry point |
| getTopStreams | top live streams | limit | viewersCount, broadcaster, game, title | entry point; raw GQL query |
| getClips | channel clips | login ← searchChannels.login | title, viewCount, durationSeconds, game | time filter: LAST_DAY/WEEK/MONTH/ALL_TIME |
| getVideos | channel VODs | channelOwnerLogin ← searchChannels.login | title, viewCount, lengthSeconds, broadcastType | sort: TIME or VIEWS |

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

# Browse top live streams
openweb twitch exec getTopStreams '{"limit":10}'

# Get clips for a channel
openweb twitch exec getClips '{"login":"shroud"}'

# Get past broadcasts for a channel
openweb twitch exec getVideos '{"channelOwnerLogin":"shroud"}'
```

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.
Not needed for basic site usage.

### API Architecture

GraphQL API at `gql.twitch.tv/gql` with persisted queries. Most read operations use a sha256 hash that maps to a server-side query — no inline query text accepted for those. Some operations (getTopStreams) use raw GQL queries. Requests require a public `Client-ID` header (`kimne78kx3ncx6brgo4mv6wki5h1ko`).

### Auth

No auth required for public data. Write operations (follow, etc.) would require `auth-token` cookie via OAuth.

### Transport

`node` transport — direct HTTP POST to `gql.twitch.tv/gql`. No browser needed; all operations are public GraphQL persisted queries or raw queries expressed as spec-native virtual paths.

### Known Issues

- **Persisted query hashes** are tied to Twitch's frontend version and may break on deploys. Hashes in `openapi.yaml` need periodic updates. getClips and getVideos use yt-dlp-validated hashes.
- **getTopStreams uses raw GQL** — not a persisted query, so more resilient to frontend deploys but could break if Twitch restricts raw queries.
- **No viewer count on getStream** — the StreamMetadata GQL query doesn't return viewer count (that's in a separate query). Use getTopStreams for viewer counts.
- **Response shape change** — responses now return raw GraphQL `data` payload (unwrapped), not the adapter-shaped output. Field paths differ from pre-migration (e.g. `data.searchFor.channels.edges[].item` instead of flat `channels[]`).
