# Bilibili — Progress

## 2026-04-11 — Discovery & Implementation

## What was added

Three reverse write operations to complement existing write ops:

| New Op | Reverses | API Endpoint | Key Param |
|--------|----------|-------------|-----------|
| unlikeVideo | likeVideo | `/x/web-interface/archive/like` | `like=2` |
| removeFromFavorites | addToFavorites | `/x/v3/fav/resource/deal` | `del_media_ids` instead of `add_media_ids` |
| unfollowUploader | followUploader | `/x/relation/modify` | `act=2` |

## Files changed

- **openapi.yaml** — 3 new path entries at virtual paths (`/x/web-interface/archive/unlike`, `/x/v3/fav/resource/unfav`, `/x/relation/unfollow`) since OpenAPI forbids duplicate POST on the same path. Also fixed all 6 write ops from `application/x-www-form-urlencoded` to `application/json` content type.
- **adapters/bilibili-web.ts** — 3 new handler functions + OPERATIONS map entries.
- **examples/** — 3 new example files with `replay_safety: unsafe_mutation`.
- **DOC.md** — documented reverse ops in workflows, operations table, and quick start.

## Patterns discovered

1. **Bilibili toggle APIs**: Like/follow/favorites all use the same endpoint for both directions, toggled by a numeric param (1=add, 2=remove). The reverse ops delegate to the forward op with the param overridden.
2. **CSRF required on all writes**: Every POST mutation needs `bili_jct` cookie value as `csrf` form param. The `getCSRFToken` helper extracts it from browser cookies.
3. **Virtual paths for OpenAPI dedup**: When the real API endpoint is shared between forward/reverse ops, the spec uses a virtual path (e.g. `/x/relation/unfollow`) while the adapter routes to the real endpoint.
4. **`safety: caution`** is the correct x-openweb field for mutation ops (not `replay_safety` — that field is only used in example JSON files, not the spec schema).

## Pitfalls

- **`replay_safety` is not a valid x-openweb operation field**. The schema (`src/types/schema.ts`) only allows `safety: 'safe' | 'caution'` on operation-level x-openweb. Using `replay_safety` causes validation failure on every op in the site.
- **`application/x-www-form-urlencoded` breaks param validation**. `getRequestBodySchema()` in `src/lib/spec-loader.ts` only reads `application/json`. Adapter-backed ops should use `application/json` in the spec (the adapter does the actual form encoding internally). This caused "Unknown parameter(s)" errors on all write ops.
- **`addToFavorites` adapter requires `add_media_ids`** — can't reuse it for remove. The `removeFromFavorites` function was written separately to require `del_media_ids` and pass empty `add_media_ids`.
- **Write ops need example files** — without `*.example.json`, the verifier can't test write ops even with `--write --ops` flags.

## Verification

- `pnpm build` — 893 files, 96 sites
- `pnpm --silent dev verify bilibili` — PASS 8/8 read ops
- `pnpm --silent dev verify bilibili --write --ops unlikeVideo,removeFromFavorites,unfollowUploader --browser` — PASS 3/3 write ops

## 2026-04-13 — Schema Fix

**Context:** searchVideos returns mixed-type items where some fields are absent depending on result type.
**Changes:** openapi.yaml — relaxed required on mixed-type search items (searchVideos response schema).
**Verification:** Verify pass; schema now aligns with observed API responses.

## 2026-04-17 — Adapter Refactor

**Context:** Phase 5C (commit be8567f) — migrate site adapters off the legacy `CodeAdapter` interface; the shared `CodeAdapter` type was removed from `src/types/adapter.ts`.
**Changes:** `adapters/bilibili-web.ts` migrated from `CodeAdapter` (init / isAuthenticated / execute) to `CustomRunner` (single `run(ctx: PreparedContext)`); 485 → 451 lines. Dropped `init()` (only checked `page.url().includes('bilibili.com')` — trivial; PagePlan covers it) and `isAuthenticated()` (only probed local SESSDATA cookie — not a real server probe). The needs_login signal now surfaces per-op via `getCSRFToken` throwing `errors.needsLogin()` when `bili_jct` is missing on write ops. All 7 op semantics preserved byte-for-byte (URLs, headers, body, returns).
**Verification:** `pnpm dev verify bilibili` — 7/8 ops PASS; 1 env failure (searchVideos: "no browser tab open").
**Key files:** `src/sites/bilibili/adapters/bilibili-web.ts`, `src/sites/bilibili/DOC.md` (Adapter Patterns section added).

## 2026-04-19 — addToFavorites verify recovery

**Context:** Write-verify campaign (handoff2 #5b). `addToFavorites` had no example file and no read-op source for the required `add_media_ids` folder id, so it couldn't verify.
**Changes:**
- New read op `listFavoriteFolders` (GET `/x/v3/fav/folder/created/list`) — returns the user's favorite folders so writes can chain to a real folder id. Spec entry, adapter handler, example with `order: 0` (so it runs before any write).
- New `addToFavorites.example.json` chains via `${prev.listFavoriteFolders.data.list.0.id}` (`order: 1`).
- `removeFromFavorites.example.json` rewritten to chain via the same template (`order: 2`) so the pair leaves the account state unchanged.
- `add_media_ids` / `del_media_ids` schema relaxed from `string` to `[string, integer]` so the chained numeric id passes validation without explicit stringification — adapter still coerces with `String()`.
**Verification:** `pnpm dev verify bilibili --ops listFavoriteFolders,addToFavorites,removeFromFavorites --browser --write` — 3/3 PASS.
**Key discovery:** Template resolver returns the raw value in whole-value mode (`"${expr}"`) but stringifies in interpolation mode. When chaining a numeric field into a string-typed param, prefer relaxing the schema over post-hoc string concatenation hacks.
**Pitfalls:** The user's account had zero created folders initially (`count: 0`), so the chain target had to be seeded by creating one (named `verify`) via `/x/v3/fav/folder/add`. Probe scripts must check this prerequisite before assuming a usable chain target exists.

## 2026-04-24 — Userflow QA

**Context:** Three blind persona workflows uncovered that all non-getDanmaku read ops were routed through `transport: node` (HTTP executor) instead of the `bilibili-web` adapter, causing -403 errors because Bilibili's WBI-signed endpoints reject unsigned requests.

### Issues found and fixed

| # | Op | Issue | Type | Fix |
|---|---|---|---|---|
| 1 | all read ops except getDanmaku | Missing `transport: page` + adapter config in spec — runtime used direct HTTP, WBI signing skipped | Adapter routing | Added `transport: page` and `adapter: { name: bilibili-web }` to all 15 operations |
| 2 | getUserProfile | Non-WBI endpoint `/x/space/acc/info` now returns -403 | API deprecation | Switched to `interceptApiResponse` navigating to `space.bilibili.com` |
| 3 | searchUserVideos | Same non-WBI -403 issue | API deprecation | Switched to intercept from `space.bilibili.com/${mid}/video` |
| 4 | getVideoComments | Non-WBI reply endpoint -403; comments lazy-load (not fired on page load) | API + SPA | Navigate to video page, scroll to trigger comment section, intercept WBI reply API; `bvid` now required |
| 5 | searchVideos | Response 40KB with noise (exp_list, pageinfo, non-video result types) | Response trimming | Adapter strips to video-only results with key fields |
| 6 | searchVideos | Titles contain `<em class="keyword">` HTML highlight tags | Response cleanup | `stripEmTags()` recursively removes `<em>` tags |
| 7 | getVideoDetail | Response 205KB with Related, Reply, elec, etc. | Response trimming | Trimmed to View (key fields), Tags, Card only → 14KB |
| 8 | getUserProfile | Response bloated with pendant, nameplate, elec, garb | Response trimming | Trimmed to essential fields (name, sign, level, official, vip, tags) |
| 9 | getDanmaku | `progress_ms` required in schema but absent on some elems | Schema | Made optional (only `content` required) |
| 10 | getPopularVideos | `pn`, `ps` required with no defaults | Schema | Made optional with defaults (1, 20) |
| 11 | getVideoComments | `type` required, no default; `bvid` absent from spec | Schema | `type` optional with default 1; `bvid` added as required |
| 12 | searchVideos | Response schema expected `result_type` wrapper | Schema | Updated to flat video object array matching trimmed output |

### Files changed

- **openapi.yaml** — Added `transport: page` + `adapter` config to all 15 operations. Fixed parameter defaults (getPopularVideos pn/ps, getVideoComments type/bvid). Relaxed getDanmaku required fields. Updated searchVideos response schema to match trimmed output.
- **adapters/bilibili-web.ts** — All read ops now use `interceptApiResponse` (navigate → intercept WBI-signed API call) instead of `fetchApiViaPage` (raw fetch, no WBI signing). Added response trimming for searchVideos, getVideoDetail, getUserProfile. Added `stripEmTags()` for search results. getVideoComments scrolls page to trigger lazy-loaded comment API.

### Root cause

Bilibili's API migration to WBI signing is now complete — all non-WBI endpoints return -403. The adapter already had the correct intercept-based approach but most operations weren't routed through it (missing `transport: page` in spec). The fix was twofold: route all ops through the adapter, and switch adapter functions from non-WBI to WBI endpoints.

### Verification

- `pnpm build` — 94 sites, 1096 files
- `pnpm --silent dev verify bilibili` — PASS 9/9 read ops
- All 9 read ops tested manually through 3 persona workflows
