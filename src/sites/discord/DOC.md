# Discord

## Overview
Real-time messaging platform. Archetype: Messaging.

## Quick Start

```bash
# Get current user profile
openweb discord exec getCurrentUser '{}'

# List your servers (guilds)
openweb discord exec listGuilds '{}'

# Get server details
openweb discord exec getGuildInfo '{"guildId": "1216071219120439316"}'

# List channels in a server
openweb discord exec listGuildChannels '{"guildId": "1216071219120439316"}'

# List roles in a server
openweb discord exec getGuildRoles '{"guildId": "1216071219120439316"}'

# Read messages in a channel
openweb discord exec getChannelMessages '{"channelId": "1280234300012494862", "limit": 50}'

# Get channel details
openweb discord exec getChannelInfo '{"channelId": "1280234300012494862"}'

# Get pinned messages
openweb discord exec getPinnedMessages '{"channelId": "1280234300012494862"}'

# Search messages in a server
openweb discord exec searchMessages '{"guildId": "1216071219120439316", "content": "hello"}'

# List DM channels
openweb discord exec getDirectMessages '{}'
```

## Operations

| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getCurrentUser | Get current user profile | GET /api/v9/users/@me | Username, avatar, email, Nitro, flags |
| listGuilds | List user's servers | GET /api/v9/users/@me/guilds | Name, icon, owner, permissions |
| getDirectMessages | List DM channels | GET /api/v9/users/@me/channels | Recipients, last message |
| getGuildInfo | Get server details | GET /api/v9/guilds/{guildId} | Name, icon, roles, members, features, premium |
| listGuildChannels | List channels in server | GET /api/v9/guilds/{guildId}/channels | Name, type, position, topic, permissions |
| getGuildRoles | List roles in server | GET /api/v9/guilds/{guildId}/roles | Name, permissions, color, hoisted |
| searchMessages | Search messages in server | GET /api/v9/guilds/{guildId}/messages/search | Full-text search, total results |
| getChannelInfo | Get channel details | GET /api/v9/channels/{channelId} | Name, type, topic, rate limit |
| getChannelMessages | Read messages in channel | GET /api/v9/channels/{channelId}/messages | Content, author, attachments, embeds, reactions |
| getPinnedMessages | Get pinned messages | GET /api/v9/channels/{channelId}/pins | Array of pinned message objects |

## API Architecture
- REST API at `discord.com/api/v9/`
- WebSocket gateway at `gateway.discord.gg` for real-time events (READY, MESSAGE_CREATE, etc.)
- Guild list and user profile data also available via REST (not only WS gateway)
- All API calls require Authorization header with user token

## Auth
- `webpack_module_walk` — user token stored in webpack module cache (`webpackChunkdiscord_app`)
- Token injected as bare `Authorization` header (no Bearer prefix)
- Token extracted from module exports under keys `default`/`Z`/`ZP` with `getToken` method
- Token format: base64-encoded user ID + dot-separated random segments (72 chars)
- Cannot be auto-detected by compiler — manually configured

## Transport
- `page` — requires browser context for webpack_module_walk token extraction
- Node transport returns 401 (no way to get token without browser JS context)

## Known Issues
- Cloudflare challenge on first visit (solve in managed browser)
- WebSocket operations not included (asyncapi.yaml removed due to validation issues with heartbeat/discriminator config)
- Guild member search (`/members/search`) returns 400 — may require specific permissions or different query format
- Some channels return 403 if user lacks read permissions (announcement channels, etc.)
