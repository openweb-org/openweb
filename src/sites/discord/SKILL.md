# Discord

## Overview
Real-time messaging platform. Archetype: Messaging.

## Workflows

### Browse server messages
1. `listGuilds` → pick guild → `guildId`
2. `listGuildChannels(guildId)` → pick channel → `channelId`
3. `getChannelMessages(channelId, limit)` → messages with content, author, timestamps

### Search a server
1. `listGuilds` → pick guild → `guildId`
2. `searchMessages(guildId, content)` → matching messages with context

### Send a message & react
1. `listGuilds` → pick guild → `guildId`
2. `listGuildChannels(guildId)` → pick channel → `channelId`
3. `sendMessage(channelId, content)` → message with ID → `messageId`
4. `addReaction(channelId, messageId, emoji)` → 204

### Undo message & reaction
1. `getChannelMessages(channelId)` → `messageId` (or use `messageId ← sendMessage`)
2. `deleteMessage(channelId, messageId)` → 204
3. `removeReaction(channelId, messageId, emoji)` → 204

### Inspect a server
1. `listGuilds` → pick guild → `guildId`
2. `getGuildInfo(guildId)` → server details, member count, features
3. `getGuildRoles(guildId)` → role list with permissions

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getCurrentUser | get my profile | — | username, email, avatar, premium_type | entry point |
| listGuilds | list my servers | — | id, name, icon, owner, permissions | entry point |
| getDirectMessages | list DM channels | — | id, type, recipients, last_message_id | entry point |
| getGuildInfo | server details | guildId ← listGuilds | name, description, owner_id, member count, features, roles | |
| listGuildChannels | channels in server | guildId ← listGuilds | id, name, type, topic, position | |
| getGuildRoles | server roles | guildId ← listGuilds | name, permissions, color, position | |
| searchMessages | search in server | guildId ← listGuilds, content (query) | total_results, messages with context | |
| getChannelInfo | channel details | channelId ← listGuildChannels | name, type, topic, guild_id | |
| getChannelMessages | read messages | channelId ← listGuildChannels | content, author, timestamp, attachments, embeds | paginated (limit, before, after) |
| getPinnedMessages | pinned messages | channelId ← listGuildChannels | content, author, timestamp | no pagination |
| sendMessage | send a message | channelId ← listGuildChannels, content | id, content, author, timestamp | write op |
| addReaction | react to message | channelId, messageId ← getChannelMessages, emoji | 204 no content | write op |
| deleteMessage | delete a message | channelId, messageId ← getChannelMessages | 204 no content | write op, reverses sendMessage |
| removeReaction | remove own reaction | channelId, messageId ← getChannelMessages, emoji | 204 no content | write op, reverses addReaction |

## Quick Start

```bash
# Get current user info
openweb discord exec getCurrentUser '{}'

# List my servers (guilds)
openweb discord exec listGuilds '{}'

# List channels in a server
openweb discord exec listGuildChannels '{"guildId":"GUILD_ID"}'

# Read messages in a channel
openweb discord exec getChannelMessages '{"channelId":"CHANNEL_ID","limit":50}'

# Search messages in a guild
openweb discord exec searchMessages '{"guildId":"GUILD_ID","content":"search term"}'

# Send a message to a channel
openweb discord exec sendMessage '{"channelId":"CHANNEL_ID","content":"Hello!"}'

# React to a message with thumbs up
openweb discord exec addReaction '{"channelId":"CHANNEL_ID","messageId":"MSG_ID","emoji":"👍"}'

# Delete a message
openweb discord exec deleteMessage '{"channelId":"CHANNEL_ID","messageId":"MSG_ID"}'

# Remove own reaction from a message
openweb discord exec removeReaction '{"channelId":"CHANNEL_ID","messageId":"MSG_ID","emoji":"👍"}'
```

## Known Limitations

- `createServer` / `createChannel` — **not supported** (removed from spec, 2026-04-20). Discord requires an `X-Super-Properties` header (base64 client-fingerprint blob) on create-entity endpoints; the page transport does not inject it and there is no discord adapter to synthesize one. All other writes (`sendMessage`, `deleteMessage`, `addReaction`, `removeReaction`) work via the same `webpack_module_walk` Authorization header. Unblock: capture a live super-properties value from the SPA bundle and add it as a constant header (or build a discord adapter).
