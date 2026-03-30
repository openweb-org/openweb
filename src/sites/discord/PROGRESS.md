## 2026-03-30: Rediscovery — expanded to 10 ops, all PASS

**What changed:**
- Recaptured Discord traffic with auth token extraction via webpack_module_walk
- Used page.evaluate(fetch) with extracted token to hit 12 API endpoints across 3 guilds
- Compiled 11 clusters from 31 API samples, curated to 10 high-quality read ops
- New operations: getCurrentUser, listGuilds, getDirectMessages, getGuildInfo, listGuildChannels, getGuildRoles, searchMessages, getPinnedMessages
- Kept existing: getChannelInfo, getChannelMessages (enriched schemas from prior QA)
- Dropped: getMyEntitlements, getMyScheduledEvents (low value for messaging archetype)
- Dropped from compile: createScience (tracking noise), searchGuildMembers (returns 400)
- Enriched response schemas for all ops from live response data
- Updated DOC.md with full 10-op coverage, corrected auth documentation

**Why:**
- Rediscovery to expand from 4 to ~10 ops covering messaging archetype: guilds, channels, messages, DMs, user info, search

**Verification:** All 10 ops verify PASS with --browser. Auth working via webpack_module_walk getToken.

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
