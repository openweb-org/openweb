# Zhihu (知乎) — Progress

## 2026-04-24 — Userflow QA: response trimming via read adapter

**Personas tested:**
1. 大学生备考研究生 — searchContent("计算机考研经验") → getMember → getUserAnswers → listSimilarQuestions
2. 创业者 — getHotSearch → searchContent("AI创业2026") → getMember → listMemberActivities
3. 技术人员 — searchContent("Rust语言入门") → listQuestionFollowers → listSimilarQuestions → getEntityWord → getFeedRecommend

All 11 read ops returned HTTP 200 with valid data.

**Findings:**
- P0: searchContent 154KB/5 items — 13 top-level noise keys, 15+ noise fields per item, full HTML `content`
- P0: getFeedRecommend 99KB/6 items — full HTML content per target, action_card/attached_info noise
- P0: listMemberActivities 169KB/8 items — one article had 74KB HTML content
- P0: getUserAnswers 12KB/3 items — 37 fields per answer, 25+ noise
- P1: getMember `include` param type:array serialized as multiple query params but Zhihu expects comma-separated — `follower_count`, `answer_count` silently missing
- P1: getMe/getHotSearch moderate bloat (vip_info, kvip_info, attached_info noise)
- P1: listMemberActivities schema mismatch (badge/content type polymorphism)

**Changes:**
- Created `adapters/zhihu-read.ts` — handles 7 read ops (searchContent, getFeedRecommend, listMemberActivities, getUserAnswers, getMember, getMe, getHotSearch) with field-level response trimming via `readTokenCache` + `nodeFetch`.
- Fixed `include` param on getMember/listMemberMutuals/listSimilarQuestions — changed from `type: array` to `type: string` with comma-separated defaults. getMember now returns `follower_count`, `answer_count` by default.
- Removed getMe `include` param (adapter handles internally).
- Updated openapi.yaml response schemas for all 7 adapter ops to match trimmed output.
- Updated 4 example files (getMe, getMember, listMemberMutuals, listSimilarQuestions) to remove array include params.
- 4 non-adapter read ops (getEntityWord, listSimilarQuestions, listQuestionFollowers, listMemberMutuals) left on normal node transport — responses already clean.

**Size reduction:**
| Operation | Before | After | Reduction |
|---|---|---|---|
| searchContent (5) | 154,793 | 5,309 | 97% |
| getFeedRecommend (6) | 98,932 | 8,061 | 92% |
| listMemberActivities (7) | 169,390 | 11,366 | 93% |
| getUserAnswers (3) | 12,063 | ~3,500 | 71% |
| getHotSearch (30) | 22,226 | 4,220 | 81% |
| getMe | ~1,077 | ~350 | 68% |
| getMember | ~1,041 | ~450 | 57% (+ now includes follower_count/answer_count) |

**Key files:** `src/sites/zhihu/adapters/zhihu-read.ts`, `src/sites/zhihu/openapi.yaml`
**Verification:** `pnpm dev verify zhihu` — 10/10 PASS.

---
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

## 2026-04-14 — Schema Drift Fix

**Context:** Verify failing on getFeedRecommend — `reaction_instruction.REACTION_COMMENT_NEWEST_LIST` not always present
**Changes:** Removed `REACTION_COMMENT_NEWEST_LIST` from required array in `reaction_instruction` object
**Verification:** 10/10 PASS
- **Stable ID convention**: Sequential `zhihu00XX` numbering — new ops got zhihu0014, zhihu0015, zhihu0016.
