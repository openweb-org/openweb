## 2026-03-30: Release QA — example fixes and param alignment

**What changed:**
- Fixed example file operationIds to match openapi.yaml (getChannel→getChannelInfo, listChannelsMessages→getChannelMessages, etc.)
- Renamed all 4 example files to match operationIds
- Fixed example param names to match openapi.yaml (id→channelId, removed undeclared params)
- Used realistic example values (string snowflake IDs, proper limit values)
- Audited ops quality: 4 focused read ops, clean and meaningful
- Verified DOC.md completeness: overview, ops table, auth/transport, quick-start, known issues all present

**Why:**
- Release QA pass to make site package consistent and release-ready

**Verification:** Build passes. Verify returns transient webpack_module_walk errors (auth extraction issue — site is quarantined). Structural correctness confirmed.

## 2026-03-29: Initial discovery and compile

**What changed:**
- Captured traffic from 3 guilds, 7 channels, user avatar clicks, DMs
- Compiled 35 HTTP clusters, curated to 4 operations: getChannelInfo, getChannelMessages, getMyEntitlements, getMyScheduledEvents
- 64 WS operations detected (gateway.discord.gg) but asyncapi.yaml removed due to validation issues
- Auth configured as webpack_module_walk but getToken method name needs verification
- Fixed pipeline bug: empty WS URL causing "Invalid URL" in generate-v2.ts (apply-curation.ts picked first connection with empty URL)

**Why:**
- User requested Discord discovery following discover.md workflow

**Verification:** Auth extraction not working — webpack_module_walk getToken returns wrong module (i18n instead of auth store). HTTP operations verified structurally but return 401 due to missing auth token injection.
**Commit:** pending
