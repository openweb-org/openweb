# Discord

## Overview
Discord — messaging and community platform. Hybrid REST + Gateway WebSocket API.

## Quick Start

```bash
# Get server info via invite code (public, no auth)
openweb discord exec get_invite '{"invite_code": "python"}'

# Get WebSocket gateway URL (public, no auth)
openweb discord exec get_gateway '{}'

# Get current user (requires auth — browser must be logged in)
openweb discord exec get_me '{}'

# Get channel messages (requires auth)
openweb discord exec get_channel_messages '{"channel_id": "123456789"}'
```

## REST Operations (5 ops)
| Operation | Intent | Method | Auth | Notes |
|-----------|--------|--------|------|-------|
| get_gateway | get WS gateway URL | GET /gateway | none | returns `wss://gateway.discord.gg` |
| get_invite | server info via invite | GET /invites/{invite_code} | none | guild name, member counts, channel |
| get_me | current user profile | GET /users/@me | webpack_module_walk | page transport required |
| get_guilds | list user's guilds | GET /users/@me/guilds | webpack_module_walk | limit param (1-200) |
| get_channel_messages | channel messages | GET /channels/{channel_id}/messages | webpack_module_walk | limit param (1-100) |

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
- WS uses `op` field as primary discriminator; dispatch events (op=0) use `t` sub-field
- `send_request_guild_members` uses `request_reply` pattern with `nonce` echo correlation
- Public endpoints (gateway, invites) work without auth via node transport

## Auth
- **REST (authenticated)**: `webpack_module_walk` — extracts token from `webpackChunkdiscord_app` via `getToken` module call, injects as `Authorization` header
- **REST (public)**: no auth needed for `get_gateway` and `get_invite`
- **WS Gateway**: `ws_first_message` — sends token in Identify payload (op=2, `d.token`)

## Transport
- **Authenticated REST**: `page` — requires Discord web app loaded in browser (webpack token extraction)
- **Public REST**: `node` — direct HTTP, no browser needed
- **WS Gateway**: `node` — direct WebSocket connection

## WS Lifecycle
1. Connect → receive Hello (op=10) with `heartbeat_interval`
2. Send Identify (op=2) with token + intents
3. Receive Ready (op=0, t=READY) with session info
4. Heartbeat loop: send op=1 with last `s` (sequence), expect op=11 ack
5. Max 3 missed heartbeat acks before reconnect (max 5 retries, 1s backoff)

## Known Issues
- Authenticated REST requires Discord web app open in browser — cannot use node transport
- Browser profile must be logged in for auth ops; login page blocks unauthenticated access
- WS auth token must be provided as param (bot token or user token)
- Cloudflare protection present but light (no CAPTCHA for API endpoints)
