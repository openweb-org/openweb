# Discord

## Overview
Real-time messaging platform. Archetype: Messaging.

## Quick Start

```bash
# Get channel details
openweb discord exec getChannelInfo '{"channelId": "1280234300012494862"}'

# Read messages in a channel
openweb discord exec getChannelMessages '{"channelId": "1280234300012494862", "limit": 50}'

# Get scheduled events
openweb discord exec getMyScheduledEvents '{}'

# Get entitlements (Nitro, boosts)
openweb discord exec getMyEntitlements '{"entitlement_type": 1}'
```

## Operations

| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getChannelInfo | Get channel details | GET /api/v9/channels/{channelId} | Returns name, type, topic, guild_id, position |
| getChannelMessages | Read messages in channel | GET /api/v9/channels/{channelId}/messages | Returns content, author, attachments, embeds, reactions |
| getMyEntitlements | Get user entitlements | GET /api/v9/users/@me/entitlements | Nitro subscriptions, boosts, premium |
| getMyScheduledEvents | Get scheduled events | GET /api/v9/users/@me/scheduled-events | Events across guilds |

## API Architecture
- REST API at `discord.com/api/v9/`
- WebSocket gateway at `gateway.discord.gg` for real-time events (READY, MESSAGE_CREATE, etc.)
- Guild list and user profile data comes through WS gateway READY event, not REST
- All API calls require Authorization header with user token

## Auth
- `webpack_module_walk` — user token stored in webpack module cache (`webpackChunkdiscord_app`)
- Token injected as bare `Authorization` header (no Bearer prefix)
- Token format: base64-encoded user ID + dot-separated random segments (72 chars)
- Cannot be auto-detected by compiler — must be manually configured
- **Known issue:** The `module_test: getToken` config may not work with Discord's current build. The internal module structure may have changed. Needs manual investigation to find the correct getter function name.

## Transport
- `page` — requires browser context for webpack_module_walk token extraction
- Node transport returns 401 (no way to get token without browser JS context)

## Known Issues
- **Auth extraction not working:** `webpack_module_walk` with `getToken` doesn't find the auth token in Discord's current webpack build. The internal module that stores the user token may use a different function name. Needs manual investigation using browser dev tools.
- Cloudflare challenge on first visit (solve in managed browser)
- Guild list and user profiles not available via REST — delivered through WS gateway READY event
- WebSocket operations not included (asyncapi.yaml removed due to validation issues with heartbeat/discriminator config)
