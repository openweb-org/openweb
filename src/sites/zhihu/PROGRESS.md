# Zhihu (知乎) — Progress

## 2026-04-11 — Discovery & Implementation

## What was done

Added 3 reverse write operations to the zhihu site package:

| Operation | Method | Path | Reverses |
|-----------|--------|------|----------|
| cancelUpvote | POST (adapter) | `/cancel-upvote/{answer_id}` → voters endpoint | upvoteAnswer |
| unfollowUser | DELETE | `/api/v4/members/{url_token}/followers` | followUser |
| unfollowQuestion | DELETE | `/api/v4/questions/{question_id}/followers` | followQuestion |

Total zhihu ops: 14 -> 17.

## Process

1. Read existing write ops (upvoteAnswer, followUser, followQuestion) to understand endpoint patterns.
2. First attempt: added DELETE methods as siblings under same OpenAPI path entries. Two issues found in verification:
   - cancelUpvote DELETE returned HTTP 500 — Zhihu doesn't support DELETE on voters endpoint
   - unfollowQuestion returned 204, not 200 — spec had wrong response code
3. Fix for cancelUpvote: Created adapter (`adapters/zhihu.ts`) that POSTs `{type: "neutral"}` to the voters endpoint via page context. Used virtual path `/cancel-upvote/{answer_id}` since the real POST path is already used by upvoteAnswer.
4. Fix for unfollowQuestion: Changed response spec from 200 with body to 204 with empty response.
5. Updated manifest.json, DOC.md, examples, and PROGRESS.md.

## Pitfalls

- **Duplicate YAML path keys**: Initial attempt created separate path entries for DELETE methods. YAML silently takes the last one, breaking OpenAPI structure. Fix: add `delete:` as a sibling of `post:` under the same path key.
- **`replay_safety` not valid in x-openweb operation schema**: The `XOpenWebOperation` type allows `safety: 'safe' | 'caution'` but not `replay_safety`. That field lives in example JSON files only (consumed by verify.ts `resolveReplaySafety()`). Using it in openapi.yaml causes "must NOT have additional properties" validation failure.
- **DELETE returns 500 on voters endpoint**: Zhihu's cancel-vote is POST with `{type: "neutral"}` to the same endpoint as upvote. DELETE is not supported. A 500 (not 405) can still indicate an unsupported method when the server's error handling is poor.
- **Same-path-same-method conflict**: OpenAPI allows only one operation per path+method pair. Since upvoteAnswer already uses POST on `/api/v4/answers/{answer_id}/voters`, cancelUpvote can't be a second POST there. Solution: use an adapter with a virtual path.
- **unfollowQuestion returns 204 not 200**: Zhihu returns 204 No Content for successful unfollow. The spec must match the actual response code, and the example assertion must expect 204 (no schema validation on empty body).

## Patterns discovered

- **Adapter for same-endpoint reverse ops**: When the forward and reverse operations share the same API path+method (POST), use an adapter to give each a distinct operationId. The adapter constructs the real HTTP call; the spec uses a virtual path. (Same pattern as bilibili's `unlikeVideo` calling `likeVideo` with different params.)
- **Mixed transport model**: A site can use `node` transport for most ops while individual ops use adapters (`page` transport) for specific needs. The runtime resolves transport per-operation.
- **Two-layer safety model**: Operation-level `x-openweb.safety` (spec metadata) and example-level `replay_safety` (verify runtime behavior) are separate concerns.
- **204 vs 200 for destructive ops**: Some reverse/delete operations return 204 No Content instead of 200 with body. Always verify actual response codes during live testing.
- **Stable ID convention**: Sequential `zhihu00XX` numbering — new ops got zhihu0014, zhihu0015, zhihu0016.
