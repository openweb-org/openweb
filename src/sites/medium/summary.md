# Medium Reverse Write Ops — Summary

## What was added
- **unfollowWriter** — reverse of `followWriter`. Calls `unfollowUser` GraphQL mutation with `targetUserId`.
- **unsaveArticle** — reverse of `saveArticle`. Calls `removeFromPredefinedCatalog` GraphQL mutation with `type: READING_LIST` and the post's `itemId`.

Both ops: `permission: write`, `safety: caution`, `requires_auth: true`.

## Files changed
| File | Change |
|------|--------|
| `adapters/queries.ts` | Added `UNFOLLOW_USER_MUTATION`, `UNSAVE_ARTICLE_MUTATION` |
| `adapters/medium-graphql.ts` | Added `unfollowWriter`, `unsaveArticle` handlers + registered in OPERATIONS map |
| `openapi.yaml` | Added `/user/{userId}/unfollow` and `/post/{postId}/unsave` paths (stable IDs md0015, md0016) |
| `manifest.json` | operation_count 12→14, l3_count 12→14 |
| `DOC.md` | Added unfollowWriter and unsaveArticle rows to operations table |
| `examples/unfollowWriter.example.json` | New; replay_safety: unsafe_mutation |
| `examples/unsaveArticle.example.json` | New; replay_safety: unsafe_mutation |

## Verification
- `pnpm build` — 96 sites, 901 files, all adapters compiled
- `pnpm --silent dev verify medium --write --browser` — 9/14 pass (all read ops); 5 write ops fail with "Permission required" (expected: no logged-in session, same as existing forward write ops)

## Patterns followed
- **safety: caution** on reverse ops (forward ops use `safety: safe`) — matches bilibili, weibo, zhihu convention
- **requestBody: application/json** — required by spec-loader's `getRequestBodySchema()`
- **replay_safety: unsafe_mutation** in example files — prevents accidental replay in CI
- **Dedicated GraphQL mutations** — `unfollowUser` parallels `followUser`; `removeFromPredefinedCatalog` parallels `addToPredefinedCatalog`

## Pitfalls
- **Build order**: `queries.ts` must be compiled before `medium-graphql.ts` because esbuild `--bundle` resolves `./queries.js` from disk. The build script iterates alphabetically, so `medium-graphql.ts` compiles first. Workaround: pre-compile `queries.ts` manually before running `pnpm build`, or rename so queries sorts first.
- **unsaveArticle mutation shape**: The `removeFromPredefinedCatalog` mutation uses `itemId: ID!` (the post ID) rather than the nested `operation` input that `addToPredefinedCatalog` uses. Medium's schema asymmetry here needs browser-verified confirmation with a real logged-in session.
- **Medium typos**: `AddToPredefinedCatalogSucces` (missing 's') is a known Medium schema typo. The remove variant uses `RemoveFromPredefinedCatalogSuccess` (correctly spelled) — verify with real API if this differs.
