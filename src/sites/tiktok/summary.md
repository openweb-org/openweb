# TikTok Write Ops — Summary

## What was added

| New Op | Type | API Endpoint | Method | Key Params |
|--------|------|-------------|--------|-----------|
| likeVideo | write (reverse: unlikeVideo) | `/api/commit/item/digg/` | POST | videoId |
| unlikeVideo | write (reverse of likeVideo) | `/api/commit/item/digg/` | POST | videoId |
| followUser | write (reverse: unfollowUser) | `/api/commit/follow/user/` | POST | userId |
| unfollowUser | write (reverse of followUser) | `/api/commit/follow/user/` | POST | userId |
| bookmarkVideo | write (reverse: unbookmarkVideo) | `/api/commit/item/collect/` | POST | videoId |
| unbookmarkVideo | write (reverse of bookmarkVideo) | `/api/commit/item/collect/` | POST | videoId |
| createComment | write (reverse: deleteComment) | `/api/comment/publish/` | POST | videoId, text |
| deleteComment | write (reverse of createComment) | `/api/comment/delete/` | POST | videoId, commentId |
| getExplore | read | `/explore` page | GET | — |

## Files changed

- `openapi.yaml` — 9 new paths (total: 14 ops, 5 read + 9 new: 8 write + 1 read)
- `adapters/tiktok-web.ts` — 10 new functions (9 ops + `internalApiCall` helper + `ensureTikTokPage`)
- `examples/*.example.json` — 9 new example files (8 with `unsafe_mutation`, 1 `safe_read`)
- `DOC.md` — expanded workflows, ops table, quick-start, internals sections
- `PROGRESS.md` — new entry for this sprint

## Patterns discovered

- **Reverse ops share endpoints with forward ops**: like/unlike both hit `/api/commit/item/digg/` with `type=1`/`type=0`. Same for follow/unfollow (`/api/commit/follow/user/`) and bookmark/unbookmark (`/api/commit/item/collect/`).
- **Write ops use form-encoded bodies**: TikTok internal APIs expect `application/x-www-form-urlencoded`, not JSON. The adapter uses `URLSearchParams` to encode bodies while the OpenAPI spec uses `application/json` for the openweb interface.
- **All write ops need page context**: signing (X-Bogus, X-Gnarly) is computed client-side, so writes must go through `page.evaluate(fetch(...))` rather than direct HTTP calls.
- **`aid=1988` query param**: TikTok's internal API endpoints require this app ID parameter.

## Bot detection notes

TikTok has aggressive bot protection on write endpoints:
- **X-Bogus / X-Gnarly signing**: Client-side computed signatures appended to every API call. The page transport handles this by running within the browser context.
- **msToken**: A session token refreshed periodically. Automatically included via cookies when using page transport.
- **Rate limiting**: Write operations may be rate-limited or temporarily blocked if too many are issued in quick succession.
- **CAPTCHA challenges**: TikTok may present CAPTCHA challenges for suspicious write activity, which will cause the API call to fail.
- **Best-effort approach**: Write ops are implemented best-effort. They work with valid session cookies and proper signing, but bot detection may block them unpredictably. If blocked, the API typically returns a non-zero `status_code`.

## Pitfalls

- `followUser` / `unfollowUser` require the numeric `userId` (from `getUserProfile().id`), not the username string.
- Write ops will silently fail if the user is not logged in — they return HTTP 200 but with a non-zero `status_code`.
- The `ensureTikTokPage` helper navigates to a TikTok page before write calls to ensure cookies and signing are active — this adds latency.

## Verification

- `pnpm build` — see build results
- `pnpm dev verify tiktok --browser` — see verification results
