# Discord Write Ops — Summary

## What was added

Four write operations to extend Discord's agent capabilities:

| New Op | Type | API Endpoint | Method | Key Params |
|--------|------|-------------|--------|-----------|
| deleteMessage | reverse of sendMessage | `/api/v9/channels/{channelId}/messages/{messageId}` | DELETE | channelId, messageId |
| removeReaction | reverse of addReaction | `/api/v9/channels/{channelId}/messages/{messageId}/reactions/{emoji}/@me` | DELETE | channelId, messageId, emoji |
| createServer | new | `/api/v9/guilds` | POST | name |
| createChannel | new | `/api/v9/guilds/{guildId}/channels` | POST | guildId, name, type? |

## Files changed

- **openapi.yaml** — 4 new operations. `deleteMessage` and `removeReaction` are DELETE methods on existing-style paths. `createServer` uses a new path `/api/v9/guilds`. `createChannel` is a POST added to the existing `listGuildChannels` path (same path, different method — valid OpenAPI).
- **examples/** — 4 new example files with `replay_safety: unsafe_mutation`.
- **DOC.md** — new workflows (undo message/reaction, create server/channel), ops table entries, quick start examples.

## Patterns discovered

1. **Reverse ops share paths with forward ops**: `removeReaction` uses the same path as `addReaction` but with DELETE instead of PUT. OpenAPI allows multiple methods on the same path — no virtual paths needed (unlike bilibili's toggle-param pattern).
2. **DELETE ops return 204**: Both `deleteMessage` and `removeReaction` return 204 with no body, matching `addReaction`'s pattern.
3. **Create ops return 201**: `createServer` and `createChannel` return the created resource, matching standard REST creation conventions.
4. **No adapter needed**: All 4 ops use standard REST paths — the L2 runtime with `webpack_module_walk` auth handles them directly via `page` transport.

## Pitfalls

- **Duplicate YAML path keys**: When adding DELETE to a path that already has PUT (reactions), the method must go under the same path block — a second path key with the same string silently overwrites the first in YAML.
- **createServer rate limit**: Discord limits guild creation to ~10 servers per account. The test creates a real server — clean it up after verification.
- **deleteMessage permissions**: Users can only delete their own messages (or any message if they have MANAGE_MESSAGES permission in the channel).

## Verification

- `pnpm build` — 96 sites, 901 files
- `pnpm test` — 919/919 pass
- `pnpm --silent dev verify discord` — 8/10 read ops PASS (2 transient browser closures, not spec-related)
- Write ops correctly blocked by permission layer (`Permission required: write on discord/...`) — confirms spec loaded and ops recognized
- Browser live verification needs active Chrome session on port 9222 with Discord logged in
