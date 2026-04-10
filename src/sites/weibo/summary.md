# Weibo Reverse Write Ops — Summary

## What was added

Three reverse write operations to complement existing write ops:

| New Op | Reverses | Weibo AJAX endpoint |
|---|---|---|
| `unlikePost` | `likePost` | `/ajax/statuses/cancelLike` |
| `unfollowUser` | `followUser` | `/ajax/friendships/destroy` |
| `unbookmarkPost` | `bookmarkPost` | `/ajax/statuses/destroyFavorites` |

## Process

1. Read `doc/dev/adding-sites.md` for conventions
2. Read existing write ops (`likePost`, `followUser`, `bookmarkPost`) in openapi.yaml and adapter
3. Identified Weibo's AJAX endpoint naming pattern: create/destroy, setLike/cancelLike, friendships/create/destroy
4. Added openapi.yaml entries mirroring the forward ops (same request schema, simpler response)
5. Added adapter functions in `weibo-web.ts` using the existing `postForm` helper
6. Created example files with `replay_safety: unsafe_mutation`
7. Updated `manifest.json` operation count 13 → 16

## Pitfalls

- **`replay_safety` is NOT a valid x-openweb field in openapi.yaml.** The schema validator (`src/types/schema.ts`) rejects additional properties. Put `replay_safety` in example `.json` files only. The verify system resolves safety from: example file → `x-openweb.permission` → HTTP method. Setting `permission: write` in the spec is sufficient — verify auto-resolves it to `unsafe_mutation`.
- **requestBody content type MUST be `application/json`, not `application/x-www-form-urlencoded`.** The runtime's `getRequestBodySchema()` in `src/lib/spec-loader.ts:191` only looks up `application/json`. Declaring `x-www-form-urlencoded` causes `getRequestBodyParameters()` to return `[]`, and verify rejects all body params as "Unknown parameter(s)". The adapter handles the actual HTTP encoding, so the spec content type is for param validation only. This affected all 7 weibo write ops (pre-existing bug in the original 4, fixed alongside the 3 new ones).
- **Weibo's reverse endpoints use the same request body as forward ops.** `cancelLike` takes the same `id` as `setLike`; `destroy` (friendships) takes the same `friend_uid` as `create`. No extra parameters needed.
- **Example files must use real IDs, not PLACEHOLDERs.** Verify with `--write` actually executes the ops, so example inputs need valid Weibo post IDs (mblogid format like `QA7PCauMY`) and user IDs (numeric like `1926909715`). Fetch real IDs from `getHotFeed` or `getPost` first.
- **The `--cdp-endpoint` flag doesn't exist on `verify`.** Use `--browser` to include page-transport ops. Verify auto-manages browser lifecycle.
- **Write ops are skipped by default in verify.** Use `--write` flag to include them. They'll fail with "Permission required: write" unless the runtime has write permission grants.
- **Reverse write ops should use `safety: caution`**, not `safety: safe`. The forward ops (like, follow, bookmark) are safe because they're additive. Reverse ops remove state and deserve the `caution` level.

## Patterns discovered

- **Endpoint naming symmetry:** Weibo consistently uses verb pairs: `setLike`/`cancelLike`, `create`/`destroy` (friendships), `createFavorites`/`destroyFavorites`. This pattern likely extends to other write pairs.
- **Adapter function pattern for write ops:** All write ops follow the same structure: extract param → validate → `postForm(page, url, body)`. The `postForm` helper handles CSRF (XSRF-TOKEN cookie → X-XSRF-TOKEN header) automatically.
- **Response schemas for reverse ops are simpler** than forward ops — typically just `{ ok: 1 }` without the full entity returned.

## Files changed

- `src/sites/weibo/openapi.yaml` — 3 new path entries
- `src/sites/weibo/adapters/weibo-web.ts` — 3 new functions + registered in OPERATIONS map
- `src/sites/weibo/examples/{unlikePost,unfollowUser,unbookmarkPost}.example.json` — 3 new fixtures
- `src/sites/weibo/manifest.json` — operation_count 13 → 16
