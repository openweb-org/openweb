## 2026-04-24: Userflow QA — response trimming and fixes

**What changed:**
- Added `soundcloud` adapter with `trimResponse()` — strips `media`, `publisher_metadata`, `track_authorization`, `monetization_model`, `policy`, `station_*`, `badges`, `creator_subscription*`, `visuals`, and 20+ other noise fields across all 4 operations
- Fixed nullable fields in openapi.yaml: `playback_count`, `likes_count`, `comment_count`, `reposts_count`, `download_count` on tracks; `playback_count` on playlist tracks (API returns null for some tracks)
- Removed `client_id` as a user-facing parameter — adapter injects it internally
- Added `transport: node` at operation level for adapter dispatch

**Size reductions:**
- searchTracks: 106KB → ~35KB (67% reduction)
- getPlaylist: 36KB → 9KB (75% reduction)
- getTrack: inline (no truncation)
- getUser: inline (no truncation)

**Personas tested:**
1. Producer — search "lo-fi beat" → getTrack → getUser chain
2. DJ — search "house remix 2026"
3. Podcast host — search "true crime podcast"

**Verification:** `pnpm --silent dev verify soundcloud`

## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- DOC.md: fixed heading hierarchy under Site Internals, corrected param names in Quick Start and Operations table to match spec
- openapi.yaml: added required fields, param examples, descriptions on nested user objects (no bare type:object)
- All 4 example files present with replay_safety

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify soundcloud`

## 2026-04-09: Initial add — 4 operations

**What changed:**
- Added SoundCloud site with 4 operations: searchTracks, getTrack, getUser, getPlaylist
- All operations use node transport to api-v2.soundcloud.com
- Public client_id configured as const param (auto-injected)
- No adapter needed — direct JSON API

**Why:**
- SoundCloud is the largest independent music platform — rich track, artist, and playlist data

**Verification:** 4/4 PASS with `pnpm --silent dev verify soundcloud`
