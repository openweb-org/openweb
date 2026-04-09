## 2026-04-09: Polish — enhanced 10→12 ops

**What changed:**
- Added 2 write operations: sendMessage, addReaction
- Added `required` arrays to all response schemas at every nesting level
- Added `description` on every property at every nesting level
- Added `verified: true` and `signals: [page-verified]` to all build sections
- Fixed DOC.md Site Internals heading levels (## → ###)
- Examples: all 12 files have `replay_safety` metadata

**Why:**
- Quality polish pass to meet spec standards checklist

**Verification:** 12/12 ops, pnpm build + verify PASS.

## 2026-03-31: Initial compile

**What changed:**
- Compiled 10 HTTP read operations covering messaging archetype
- Operations: getCurrentUser, listGuilds, getGuildInfo, listGuildChannels, getChannelInfo, getChannelMessages, getPinnedMessages, getDirectMessages, searchMessages, getGuildRoles
- Auth: webpack_module_walk (webpackChunkdiscord_app, getToken), Transport: page

**Why:**
- Net-new site package for Discord messaging platform
- Target intents: user info, server listing, channel browsing, message reading, search

**Verification:** 10/10 PASS with --browser. getCurrentUser returns live data.
