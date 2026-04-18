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
1. `deleteMessage(channelId, messageId)` → 204
2. `removeReaction(channelId, messageId, emoji)` → 204

### Create a server & channel
1. `createServer(name)` → server with ID → `guildId`
2. `createChannel(guildId, name, type?)` → channel with ID → `channelId`

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
| createServer | create a server | name | id, name, owner_id, roles, channels | write op |
| createChannel | create a channel | guildId ← listGuilds, name, type? | id, type, name, guild_id, position | write op |

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

# Create a new server
openweb discord exec createServer '{"name":"My New Server"}'

# Create a text channel in a server
openweb discord exec createChannel '{"guildId":"GUILD_ID","name":"general-chat"}'
```

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.
Not needed for basic site usage.

### API Architecture
- REST API on `discord.com/api/v9/`
- JSON responses
- Thick SPA — all data via internal API, no SSR

### Auth
- **Type:** `webpack_module_walk` — token stored in webpack module cache
- **Chunk global:** `webpackChunkdiscord_app`
- **app_path:** `/channels/@me` — webpack bundle only loads on the app page, not the landing page
- **Transport must be `page`** — token cannot be extracted without browser context

### Transport
- `page` transport required (webpack_module_walk auth)
- Page URL: `https://discord.com/channels/@me`

### Known Issues
- Verify: all ops PASS (schema-level); live exec requires active Discord browser session (webpack_module_walk auth)
- Bot detection: Low — browser-only SPA, no commercial bot detection
- Rate limiting: Discord enforces per-route rate limits with `Retry-After` headers
- webpack_module_walk auth cannot be auto-detected by compiler — must be manually configured
