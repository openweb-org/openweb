## 2026-04-01: Rediscovery — 4 operations (searchChannels, getChannel, getStream, getTopGames)

**What changed:**
- Fresh capture via `--isolate --url` with scripted GQL calls
- Auto-compile produced noise (single GQL endpoint); switched to adapter-only approach
- Wrote adapter with 4 operations using persisted query hashes
- Confirmed all hashes still valid (status 200 on all captures)

**Why:**
- Old package deleted from worktree; rediscovery from scratch
- Focused on 4 core operations per user request

**Verification:** All 4 operations returned 200 during capture. Pending `openweb verify`.

## 2026-04-13 — Schema Fix

**Context:** Stream and game objects are null when a channel is offline, causing required-field validation failures.
**Changes:** openapi.yaml — removed `required` on stream and game object schemas.
**Verification:** Verify pass — schema accepts both online (populated) and offline (null) states.

## 2026-04-24 — Userflow QA: Response Trimming

**Personas tested:**
1. Gamer — searched "Valorant", browsed clips/VODs for shroud
2. Esports fan — found tournament streams (VALORANT_EMEA live), checked channel profile
3. Aspiring streamer — browsed top categories, top streams

**Issues found & fixed:**
- **Response bloat (all 6 persisted-query ops):** Raw GraphQL responses included `__typename`, `trackingID`, cursors, embedded videos/clips, guest star data, preview thumbnail properties, etc. searchChannels was 358KB for 10 results.
- **Fix:** Replaced all persisted queries with inline `graphql_query` selecting only documented fields. Twitch GQL accepts inline queries (getTopStreams already used one).
- **getTopGames root field change:** Inline queries use `games` (public schema) instead of `directoriesWithTags` (persisted-query-only). Updated response schema to match.
- **getClips criteria type:** Twitch's criteria input type is not publicly exposed; hardcoded `{filter: LAST_WEEK}` inline. Removed user-facing `criteria` parameter.
- **getChannel missing lastBroadcast:** Added `lastBroadcast.game.displayName` to response schema.
- **getStream trimmed:** Removed `profileImageURL`, `primaryColorHex`, `roles`, `primaryTeam` from response — not relevant to stream status check.

**Size reductions:**
| Operation | Before | After | Reduction |
|---|---|---|---|
| searchChannels | 358 KB | 3.9 KB | 99% |
| getTopGames | 24 KB | 9.3 KB | 62% |
| getClips | 28 KB | 9.4 KB | 67% |
| getVideos | 38 KB | 14.8 KB | 61% |
| getChannel | bloated inline | clean inline | ~60% |
| getStream | bloated inline | clean inline | ~70% |

**All 7 operations verified:** 200 status, no schema warnings, edge cases (null user, offline stream) handled correctly.
