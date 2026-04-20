## 2026-04-20 — Spec Trim (handoff5)

**Context:** `createChannel` + `createServer` returned 401/403 in handoff4 even though `sendMessage`/`deleteMessage`/`addReaction`/`removeReaction` all pass with the same `webpack_module_walk` Authorization header. Root cause: Discord additionally requires an `X-Super-Properties` (base64 client fingerprint) header on create-entity endpoints, which the page transport doesn't inject and no discord adapter exists to synthesize.
**Changes:** Removed `createChannel` (lines 469-578) and `createServer` (entire `/api/v9/guilds:` path, lines 1476-1563) from `openapi.yaml` plus their example files. SKILL.md Known Limitations + DOC.md Known Issues updated with super-properties gap and unblock path. (commit b72fa57)
**Verification:** discord re-verified at 14/14 PASS after removal.
**Key discovery:** Discord splits its endpoint set by required-header surface — read endpoints + per-channel writes accept `Authorization`-only, but any "create new entity" endpoint adds `X-Super-Properties` as an implicit gate. Authorization passing is **not** sufficient evidence that all writes will pass.
**Pitfalls encountered:** First attempt at the YAML deletion overran into the next path block (lines 469-984 instead of 469-578) because the next path-method line wasn't checked; fix relied on `grep -n "^    post:\|^    get:"` to derive the correct boundary. See handoff5 §5.3.

## 2026-04-18 — Write-op verify fix
**Context:** addReaction / removeReaction were failing in `verify --write`: (a) hard-coded `messageId` in the fixtures pointed at a deleted message (404), and (b) the `emoji` example was pre-URL-encoded (`"%F0%9F%91%8D"`) which the runtime then `encodeURIComponent`-ed again → `"%25F0%259F%2591%258D"` → Discord 400.
**Changes:** Refreshed `messageId` from a live `getChannelMessages` call against `#welcome`; replaced encoded emoji with raw `"👍"`; added `order=1/2` so addReaction precedes removeReaction; updated `openapi.yaml` / SKILL.md / DOC.md `emoji` description to specify raw input. Code unchanged. (commit 149541b)
**Verification:** 2/2 PASS — addReaction, removeReaction.
**Key discovery:** Path-interpolated string params that already contain `%XX` sequences double-encode silently. The fix is at the fixture/spec layer (always raw), not at the runtime — encoding once is the right runtime behavior.

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
