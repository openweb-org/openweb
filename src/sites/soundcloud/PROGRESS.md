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
