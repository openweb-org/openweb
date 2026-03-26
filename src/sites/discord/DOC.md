# Discord

## Overview
Discord API — hybrid REST + Gateway WebSocket. Chat and community platform.

## REST Operations (3 ops)
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getMe | current user profile | GET /users/@me | |
| getGuilds | list user's guilds | GET /users/@me/guilds | limit param (1-200) |
| getChannelMessages | get channel messages | GET /channels/{channel_id}/messages | limit param (1-100) |

## WebSocket Operations (12 ops)
| Operation | Action | Pattern | Opcode | Notes |
|-----------|--------|---------|--------|-------|
| receive_hello | receive | stream | op=10 | contains heartbeat_interval |
| receive_heartbeat_ack | receive | stream | op=11 | |
| receive_ready | receive | stream | op=0, t=READY | session_id, resume_gateway_url |
| receive_message_create | receive | stream | op=0, t=MESSAGE_CREATE | |
| receive_guild_create | receive | stream | op=0, t=GUILD_CREATE | |
| receive_presence_update | receive | stream | op=0, t=PRESENCE_UPDATE | |
| receive_typing_start | receive | stream | op=0, t=TYPING_START | |
| send_identify | send | publish | op=2 | token + intents + properties |
| send_heartbeat | send | publish | op=1 | d = last sequence number |
| send_resume | send | publish | op=6 | token + session_id + seq |
| send_update_presence | send | publish | op=3 | status, activities, afk |
| send_request_guild_members | send | request_reply | op=8 | nonce-correlated response |

## API Architecture
- **REST**: API v9 at `discord.com/api/v9` — standard resource endpoints
- **Gateway WS**: `wss://gateway.discord.gg/?v=10&encoding=json` — event-driven, opcode-discriminated
- WS uses `op` field as primary discriminator; dispatch events (op=0) use `t` sub-field (e.g. `READY`, `MESSAGE_CREATE`)
- `send_request_guild_members` uses `request_reply` pattern with `nonce` echo correlation

## Auth
- **REST**: `webpack_module_walk` — extracts token from Discord's webpack bundles via `webpackChunkdiscord_app` → `getToken` module call, injects as `Authorization` header
- **WS Gateway**: `ws_first_message` — sends token in Identify payload (op=2, `d.token`), sourced from param

## Transport
- **REST**: `page` — requires Discord web app loaded in browser (webpack token extraction)
- **WS Gateway**: `node` — direct WebSocket connection

## WS Lifecycle
1. Connect → receive Hello (op=10) with `heartbeat_interval`
2. Send Identify (op=2) with token + intents
3. Receive Ready (op=0, t=READY) with session info
4. Heartbeat loop: send op=1 with last `s` (sequence), expect op=11 ack
5. Max 3 missed heartbeat acks before reconnect (max 5 retries, 1s backoff)

## Known Issues
- REST requires Discord web app open in browser — cannot use node transport
- WS auth token must be provided as param (bot token or user token)
