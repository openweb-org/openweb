# TikTok — Discovery & Implementation

## Final Architecture

- **Reads**: API response interception (navigate to page → capture `/api/*` response) + 3 replay ops
- **Writes**: `page.evaluate(fetch(...))` via TikTok's patched `window.fetch` — auto-signs with X-Bogus, X-Gnarly, msToken, ztca-dpop
- **CSRF**: Extracted from webpack HTTP client module (source-pattern match: `csrfToken` + `runFetch` + `fetchData`)
- **Zero DOM**: no CSS selectors, no meta tag parsing, no SSR global name dependency
- **25 operations total** (12 read + 13 write)

## Discovery Journey

### Phase 0: Initial Write Ops (blind, pre-probe)

The original adapter was written without a probe phase. Write ops were added by guessing API endpoints:
- Hardcoded `/api/commit/item/digg/?aid=1988`, `/api/commit/follow/user/?aid=1988`, etc.
- Body format guessed as `application/x-www-form-urlencoded`
- No CSRF token, no signing verification, no evidence these were the real endpoints

Read ops used SSR hydration data scraping:
- `__UNIVERSAL_DATA_FOR_REHYDRATION__.__DEFAULT_SCOPE__['webapp.video-detail']` for video data
- `__UNIVERSAL_DATA_FOR_REHYDRATION__.__DEFAULT_SCOPE__['webapp.user-detail']` for profiles
- DOM fallback with CSS selectors (`[data-e2e="followers-count"]`, meta tags) when SSR failed
- API response interception for getVideoComments, getHomeFeed, getExplore

This "works until it doesn't" approach had three layers of fragility.

### Phase 1: Verification Failures — Everything Breaks

Running `verify tiktok --write --browser` revealed cascading failures:

**Problem 1: `__name` polyfill lost after navigation.**
tsx (dev-mode TypeScript runner) injects `__name(fn, "name")` into all functions via esbuild's `keepNames: true`. The framework's `ensurePagePolyfills()` injected `__name` once via `page.evaluate()`, but every `page.goto()` in the adapter wiped the page's JS context. Result: `ReferenceError: __name is not defined` on any `page.evaluate(() => { ... })` after navigation.

**Fix**: Changed `page-polyfill.ts` to use `page.addInitScript()` so the polyfill survives navigations. Also applied it immediately to the current document.

**Problem 2: SSR global renamed.**
TikTok silently renamed `__UNIVERSAL_DATA_FOR_REHYDRATION__` to `__$UNIVERSAL_DATA$__`. The old global still exists but is an empty object. SSR extraction returned null for everything, falling through to broken DOM fallbacks.

**Problem 3: DOM fallbacks returned garbage.**
- `getUserProfile`: `[data-e2e="followers-count"]` selector picked up the label text "Following" instead of the numeric value. Stats came back as strings `"Following"`, `"Followers"`, `"Likes"`.
- `getVideoDetail`: DOM fallback was missing required schema fields (`stats`, `video.id`, `author.id`). It returned a skeleton with just `id` and `description` from meta tags.

**Problem 4: Type drift.**
TikTok's SSR data changed `createTime` and `collectCount` from integers to strings. The normalizer passed them through without coercion, failing schema validation.

**Problem 5: Fake example video IDs.**
All example files used `videoId: "7345678901234567890"` which doesn't exist on TikTok. SSR returned `statusCode: 10204` ("item doesn't exist"), so getVideoDetail always fell through to the (broken) DOM fallback.

**Problem 6: Browser connection death.**
Running 14 ops sequentially would crash the CDP connection mid-verify. First few ops passed, then one op would trigger "Target page, context or browser has been closed", and every subsequent op failed with "No browser context available." Root cause: stale browser state from prior sessions. Fresh browser restart resolved it, but it was intermittent and hard to debug.

**Problem 7: shape-diff false positive on empty arrays.**
`getVideoDetail` returned `challenges: []` (the test video has no hashtags). The schema declares `required: [id, title]` on `challenges` items. `diffShape()` Phase 2 checked required fields against response fields — but `extractFields()` on an empty array produces no item paths, so `challenges[].id` was flagged as `required_missing`. Phase 3 already had empty-array protection for `schema_mismatch` but Phase 2 lacked it.

**Fix**: Added `if (!responseHasArrayItems && path.includes('[]')) continue` to Phase 2 in `shape-diff.ts`.

### Phase 2: Probe — Understanding TikTok's Internals

After patching the immediate failures, I realized the architecture was fundamentally fragile. Three fallback layers (SSR → intercept → DOM) meant three places that could break independently. Comparing to the Telegram adapter (which uses a single clean `callApi()` via webpack module walk), the TikTok adapter needed a proper probe phase.

Probed TikTok via CDP on headed Chrome, running 8 probe scripts:

**Probe 1-2: Webpack discovery.**
- `webpackChunk_byted_secsdk_captcha` — only the CAPTCHA SDK (186 modules). NOT the main app.
- Main app uses `__LOADABLE_LOADED_CHUNKS__` — 165 chunks, 3787 modules total.
- Injectable via `chunks.push([[Symbol()], {}, r => { req = r }])` — gives webpack require.
- TikTok also uses VMOK (module federation) and Garfish (micro-frontend), but the main content modules are in the standard webpack bundle.

**Probe 3-4: Fetch interceptor analysis.**
- `window.fetch` is monkey-patched — 3505 chars, not native.
- `window._fetch` exists but is also patched (another layer). The chain: custom fetch → signing → `_fetch` → ... → native.
- `window.byted_acrawler` exists with methods: `frontierSign`, `init`, `setTTWebid`, `setTTWid`, etc.
- `frontierSign` is obfuscated: `function K(n){return j(50514,t,this,arguments,0,25)}` — can't be called from Node.

**Probe 5: Real signing verification via CDP.**
Made a real `fetch('/api/commit/item/digg/?aid=1988', {body: ...})` from page context and captured the actual network request via `CDP Network.requestWillBeSent`. The fetch interceptor automatically added:
- URL params: `X-Bogus`, `X-Gnarly`, `msToken`, `ztca-dpop`, `ztca-version`
- Headers: `tt-ticket-guard-client-data`, `tt-ticket-guard-version`, `tt-ticket-guard-web-version`, `tt-ticket-guard-public-key`, `tt-ticket-guard-iteration-version`

**This confirmed: `page.evaluate(fetch(...))` gets full signing automatically.** No manual X-Bogus computation needed.

**Probe 6-7: Service module architecture.**
Found TikTok's service class pattern: `function e(t){this.fetch=t}` with methods like `t.postLikeVideo = function(e){return this.fetch.post("/api/...", {query:e, headers:{...csrfToken}})}`.

Key service modules:
- `16325`: `postLikeVideo`, `postDislikeVideo`, `collectVideo`
- `46644`: `getUserDetail`, `postCommitFollowUser`, `blockUser`
- `54553`: 17 feed/list methods
- `22890`: 5 search methods
- `47224`: 24 IM methods
- `45146`: HTTP client singleton with `.get()`, `.post()`, `.csrfToken`

**Probe 8: CSRF token extraction.**
Module `45146` exports the HTTP client singleton. Its `.csrfToken` property contains the active CSRF token. Found by source-pattern matching (module source contains `csrfToken` + `runFetch` + `fetchData`), not by module ID (which changes per deploy).

**112+ API endpoints cataloged** from module 47876 (endpoint registry array).

### Phase 3: Architecture Decision — Intercept vs Webpack Walk

Considered the Telegram approach: find service classes by source pattern, call methods directly via `page.evaluate`.

**Rejected because:**
1. Module IDs are per-deploy mangled numbers (`16325`, `45146`). Telegram's `callApi` has stable string signatures (`callMethod`, `cancelApiProgress`) that survive across deploys. TikTok's service classes don't have equivalently stable signatures.
2. The `t` export from module 16325 has `.read` and `.write` sub-objects, but they weren't fully initialized at probe time — calling `svc.write.postLikeVideo({...})` was uncertain.
3. The fetch interceptor already handles ALL signing. The service classes ultimately call `this.fetch.post(url, ...)` which calls the same patched `window.fetch`. There's no signing advantage.
4. The endpoint URLs themselves ARE stable (they're hardcoded strings in the source, not computed). So hardcoding `/api/commit/item/digg/` in the adapter is equivalent to what the service class does.

**Decision: keep `page.evaluate(fetch(...))` for writes (proven, auto-signed), switch reads from SSR to API intercept.**

### Phase 4: Rewrite — Intercept-First Architecture

**Reads rewritten** to API response interception:
- `getVideoDetail`: Navigate to video page → intercept `/api/item/detail/` → normalize
- `getUserProfile`: Navigate to profile page → intercept `/api/user/detail/` → normalize
- `getVideoComments`: Navigate → intercept `/api/comment/list/` → normalize
- `getHomeFeed`: Navigate `/foryou` → intercept `/api/recommend/item_list/`
- `getExplore`: Navigate `/explore` → intercept `/api/explore/item_list/`

Thin SSR fallback kept for getVideoDetail and getUserProfile only (single `page.evaluate`, no DOM).

**All DOM fallback code deleted.** Zero CSS selectors in the adapter.

**`extractSSRData()` function deleted.** No dependency on any global variable name.

**CSRF token injection added** to `internalApiCall()` — extracted from webpack HTTP client via source-pattern matching.

**Shared `interceptApi()` helper** extracted — all intercept ops use the same navigate-and-capture pattern.

Code reduced from 665 → 350 lines (before new ops).

### Phase 5: New Ops from Probe Discovery

The probe cataloged 112+ endpoints. Used this to add ops beyond the original set:

**Batch 1 (4 ops):** `getUserVideos` (intercept `/api/post/item_list/`), `searchUsers` (replay `/api/search/user/full/`), `likeComment`/`unlikeComment` (write `/api/comment/digg/`).

**Pitfall with `getUserVideos`:** The profile page calls `/api/post/item_list/` on initial load, but if the adapter already navigated to the same profile URL (e.g., after `getUserProfile`), TikTok's SPA won't re-fetch. Fix: detect same-URL and navigate to `about:blank` first to force a fresh load.

**Batch 2 (7 ops):** Probed remaining endpoints to confirm params and response format before implementing.
- `getCommentReplies` (replay `/api/comment/list/reply/`) — confirmed working with `item_id` + `comment_id` params
- `getHashtagDetail` (replay `/api/challenge/detail/`) — confirmed with `challengeName` param
- `getHashtagVideos` (intercept from `/tag/{name}` page) — confirmed 30 items returned
- `getRelatedVideos` (intercept from video page + scroll) — confirmed 14 items
- `replyComment` (write, reuses `/api/comment/publish/` with `reply_id` param)
- `blockUser`/`unblockUser` (write `/api/user/block/`) — params confirmed from webpack module 46644 source

**Skipped:**
- `getMusicDetail`/`getMusicVideos` — returns 400, needs extra params (language headers) not easily reproducible
- `getUserLikedVideos`/`getUserBookmarks` — needs `secUid` from app state, complex param resolution
- `deleteVideo` — transact level, too dangerous
- `updateProfile` — complex params, partially irreversible
- `sendMessage` — multi-step IM protocol with token exchange

## Key Patterns Discovered

- **Fetch interceptor auto-signs**: TikTok's monkey-patched `window.fetch` adds X-Bogus, X-Gnarly, msToken, ztca-dpop to every request. No manual signing needed.
- **`byted_acrawler.frontierSign()`**: The signing SDK. Obfuscated — cannot be called from Node.
- **CSRF token in webpack**: Found by source-pattern match (`csrfToken` + `runFetch` + `fetchData`), not by module ID.
- **Service class pattern**: `this.fetch.post("/api/...")` — but module IDs are deployment-specific, so direct service-class invocation is fragile.
- **112+ endpoints**: All discoverable from webpack module 47876 (endpoint registry).
- **SSR global renamed**: `__UNIVERSAL_DATA_FOR_REHYDRATION__` → `__$UNIVERSAL_DATA$__` — demonstrates why SSR scraping is fragile.
- **SPA same-URL navigation skips API calls**: Need `about:blank` intermediate navigation to force re-fetch.
- **shape-diff empty-array bug**: `required_missing` check didn't skip array-item paths when the array was empty.
- **`page.addInitScript()` survives navigation**: Unlike `page.evaluate()`, init scripts persist across `page.goto()`.

## Probe Evidence

### Signing headers (captured via CDP)

A bare `fetch('/api/commit/item/digg/?aid=1988', { method: 'POST', body: '...' })` from page context produces:
```
URL params added: X-Bogus, X-Gnarly, msToken, ztca-dpop, ztca-version
Headers added: tt-ticket-guard-client-data, tt-ticket-guard-version,
               tt-ticket-guard-web-version, tt-ticket-guard-public-key,
               tt-ticket-guard-iteration-version
```

### Service module map

| Module | Methods | Endpoints |
|--------|---------|-----------|
| 16325 | postLikeVideo, postDislikeVideo, collectVideo | /api/commit/item/digg/, /api/dislike/item/, /api/item/collect/ |
| 46644 | getUserDetail, postCommitFollowUser, blockUser | /api/user/detail/, /api/commit/follow/user/, /api/user/block/ |
| 54553 | 17 feed/list methods | /api/recommend/item_list/, /api/explore/item_list/, /api/post/item_list/, ... |
| 22890 | getTopSearch, getUserSearch, getVideoSearch, ... | /api/search/general/full/, /api/search/user/full/, ... |
| 47224 | 24 IM methods | /api/im/* |
| 67040 | getNoticeGroupData, postFollowReplyApprove, ... | /api/notice/*, /api/commit/follow/request/* |

### Full endpoint catalog (from module 47876)

112+ endpoints including: /api/comment/list/, /api/comment/list/reply/, /api/comment/publish/, /api/comment/delete/, /api/comment/digg/, /api/commit/item/digg/, /api/commit/follow/user/, /api/item/collect/, /api/user/detail/, /api/user/block/, /api/item/detail/, /api/search/general/full/, /api/search/user/full/, /api/recommend/item_list/, /api/explore/item_list/, /api/post/item_list/, /api/challenge/detail/, /api/challenge/item_list/, /api/related/item_list/, /api/music/detail/, /api/im/*, /api/collection/*, /api/playlist/*, /api/update/profile/, /api/aweme/delete/, and more.

## Pitfalls

- `followUser` / `unfollowUser` / `blockUser` / `unblockUser` require numeric `userId` (from `getUserProfile().id`), not username
- Write ops return HTTP 200 with non-zero `status_code` on failure (silent fail) — check `status_code === 0`
- CSRF token extraction is best-effort — writes may still work without it, but some endpoints require it
- `ensureTikTokPage` adds latency on first write op (navigates if not already on tiktok.com)
- `getUserVideos` needs `about:blank` intermediate navigation if already on the same profile URL
- Browser connection fragility: sequential ops can crash CDP with stale browser state — restart browser before full verify
- `getMusicDetail` / `getMusicVideos` need extra params (language) — not implemented
- `getUserLikedVideos` / `getUserBookmarks` need `secUid` from app state — not implemented

## Verification

**Result: 25/25 PASS** (2026-04-10)

12 read ops + 13 write ops, all passing.
