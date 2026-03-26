# Twitch Fixture

## Overview

Twitch is a live streaming platform. All public data is served through a GraphQL API at `gql.twitch.tv/gql` using **persisted queries** (sha256 hashes, no inline query text). A public `Client-ID` header is required but no auth token for public data.

## Architecture

- **Transport**: `page` — browser fetch via same-origin to avoid bot detection
- **API type**: GraphQL with persisted queries (operationName + sha256Hash) for reads; inline mutations for writes
- **Auth**: None for public data; `auth-token` cookie for write operations (follow)
- **Client-ID**: `kimne78kx3ncx6brgo4mv6wki5h1ko` (public anonymous key)

## Operations (11)

### Read Operations (10)

| Operation | Description |
|-----------|-------------|
| `searchChannels` | Search channels/streams by keyword |
| `getChannelInfo` | Channel profile, followers, social links, partner status |
| `getStreamInfo` | Current stream status (live/offline, game, viewers) |
| `getChannelSchedule` | Weekly schedule segments, recent VODs, live status |
| `getChannelVideos` | Video shelves (featured clips, broadcasts, highlights) |
| `getChannelClips` | Channel clips with time filter and pagination |
| `browseCategories` | Top categories/games by viewer count |
| `getCategoryStreams` | Live streams within a specific category |
| `getTopStreams` | Homepage stream shelves (top live across categories) |
| `getFeaturedStreams` | Editorially featured/promoted streams |

### Write Operations (1)

| Operation | Description | Safety |
|-----------|-------------|--------|
| `followChannel` | Follow a channel (requires auth) | ✅ SAFE — reversible (unfollow via Twitch UI) |

## Key Patterns

- **Persisted queries**: Twitch does not accept inline GQL queries for reads. Each read operation is identified by a sha256 hash that maps to a server-side query. Hashes may change when Twitch deploys new frontend versions.
- **Inline mutations**: Write operations (follow) use inline GraphQL mutation text with an OAuth authorization header.
- **Batched requests**: The browser often batches multiple GQL operations in a single POST. The adapter sends one operation per request for simplicity.
- **Auth for writes**: Read operations work without login. Write operations require `auth-token` cookie (set via `openweb login twitch`).
- **Cursor pagination**: Clips and search use cursor-based pagination.

## Limitations

- Persisted query hashes are tied to Twitch's frontend version and may break on updates
- Chat messages require WebSocket (not supported)
- Subscriber-only content requires auth
- VOD playback tokens require additional API calls
