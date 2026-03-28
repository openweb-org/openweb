## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml + asyncapi.yaml specs

**Why:**
- Document 3 REST + 12 WS operations, including complex Gateway lifecycle

**Verification:** spec review only — no new capture or compilation

## 2026-03-28: Rediscovery — added public operations

**What changed:**
- Fresh capture of Discord traffic (login-blocked, unauthenticated)
- Discovered 2 new public operations: get_gateway, get_invite
- Restored old spec's 3 auth-required REST ops + 12 WS gateway ops
- Merged into 5 REST + 12 WS operations total
- Renamed operation IDs to snake_case (getMe→get_me, getGuilds→get_guilds, getChannelMessages→get_channel_messages)

**Why:**
- Rediscovery initiative — clean slate capture to validate and expand coverage
- Public ops (get_gateway, get_invite) work without auth, useful for server discovery

**Verification:** get_gateway and get_invite verified via node transport (200 OK, JSON response). Auth-required ops not re-verified (login-blocked).
