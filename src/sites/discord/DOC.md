# Discord

## Overview
Real-time messaging platform. Archetype: Messaging.

## Quick Start

```bash
# Get current user info
openweb discord exec getCurrentUser '{}'

# List my servers (guilds)
openweb discord exec listGuilds '{}'

# Get server info
openweb discord exec getGuildInfo '{"guildId":"GUILD_ID"}'

# List channels in a server
openweb discord exec listGuildChannels '{"guildId":"GUILD_ID"}'

# Read messages in a channel
openweb discord exec getChannelMessages '{"channelId":"CHANNEL_ID","limit":50}'

# Search messages in a guild
openweb discord exec searchMessages '{"guildId":"GUILD_ID","content":"search term"}'
```

## Operations

| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getCurrentUser | Get my profile | GET /api/v9/users/@me | Auth required |
| listGuilds | List my servers | GET /api/v9/users/@me/guilds | Returns partial guild objects |
| getGuildInfo | Get server details | GET /api/v9/guilds/{guildId} | Full guild object |
| listGuildChannels | List server channels | GET /api/v9/guilds/{guildId}/channels | All channel types |
| getChannelInfo | Get channel details | GET /api/v9/channels/{channelId} | Single channel |
| getChannelMessages | Read messages | GET /api/v9/channels/{channelId}/messages | Paginated, limit param |
| getPinnedMessages | Get pinned messages | GET /api/v9/channels/{channelId}/pins | No pagination |
| getDirectMessages | List DM channels | GET /api/v9/users/@me/channels | DM and group DM |
| searchMessages | Search in guild | GET /api/v9/guilds/{guildId}/messages/search | Query params |
| getGuildRoles | Get server roles | GET /api/v9/guilds/{guildId}/roles | Role list |

## API Architecture
- REST API on `discord.com/api/v9/`
- JSON responses
- Thick SPA — all data via internal API, no SSR

## Auth
- **Type:** `webpack_module_walk` — token stored in webpack module cache
- **Chunk global:** `webpackChunkdiscord_app`
- **Transport must be `page`** — token cannot be extracted without browser context

## Transport
- `page` transport required (webpack_module_walk auth)
- Page URL: `https://discord.com/channels/@me`

## Known Issues
- Bot detection: Low — browser-only SPA, no commercial bot detection
- Rate limiting: Discord enforces per-route rate limits with `Retry-After` headers
- webpack_module_walk auth cannot be auto-detected by compiler — must be manually configured
