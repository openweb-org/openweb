# Twitch

## Overview

Live streaming platform. All public data served through a GraphQL API at `gql.twitch.tv/gql` using persisted queries (sha256 hashes) or raw GQL queries. No auth needed for public reads.

## Workflows

### Find a streamer and check if they're live
1. `searchChannels(query)` → `edges[].item.login` (channelLogin), `displayName`, `followers.totalCount`
2. `getStream(channelLogin)` → `stream` (null = offline), `stream.game.name`, `lastBroadcast.title`

### Browse a channel profile
1. `searchChannels(query)` → `edges[].item.login`
2. `getChannel(channelLogin)` → `description`, `followers.totalCount`, `socialMedias[]`, `roles.isPartner`

### Discover popular games
1. `getTopGames(limit, sort)` → `edges[].node.displayName`, `viewersCount`, `broadcastersCount`, `tags[]`

### Browse top live streams
1. `getTopStreams(limit)` → `edges[].node.viewersCount`, `broadcaster.login`, `broadcaster.displayName`, `game.name`

### Get clips for a channel
1. `searchChannels(query)` → `edges[].item.login`
2. `getClips(login, criteria)` → `edges[].node.title`, `viewCount`, `durationSeconds`, `game.name`

### Get past broadcasts for a channel
1. `searchChannels(query)` → `edges[].item.login` → use as `channelOwnerLogin`
2. `getVideos(channelOwnerLogin)` → `edges[].node.title`, `viewCount`, `lengthSeconds`, `broadcastType`

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchChannels | find channels by keyword | query | login, displayName, followers.totalCount, broadcastSettings.title | entry point; cursor pagination |
| getChannel | channel profile | channelLogin ← searchChannels.login | displayName, followers.totalCount, roles.isPartner, socialMedias[], schedule.nextSegment | |
| getStream | live stream status | channelLogin ← searchChannels.login | stream (null=offline), stream.game.name, lastBroadcast.title | |
| getTopGames | top categories/games | limit, sort | displayName, viewersCount, broadcastersCount, tags | entry point |
| getTopStreams | top live streams | limit | viewersCount, broadcaster.login, broadcaster.displayName, game.name | entry point; raw GQL query |
| getClips | channel clips | login ← searchChannels.login | title, viewCount, durationSeconds, game.name | time filter: LAST_DAY/WEEK/MONTH/ALL_TIME |
| getVideos | channel VODs | channelOwnerLogin ← searchChannels.login | title, viewCount, lengthSeconds, broadcastType, game.name | sort: TIME or VIEWS |

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
