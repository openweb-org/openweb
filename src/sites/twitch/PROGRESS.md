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
