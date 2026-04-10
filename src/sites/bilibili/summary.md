# Bilibili Reverse Write Ops — Summary

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
