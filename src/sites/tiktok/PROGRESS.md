## 2026-04-24 — Userflow QA: response trimming and fixes

**Context:** Blind userflow QA with 3 personas: marketing manager (search "brand marketing tips"), foodie (search "easy dinner recipe"), trend analyst (getHomeFeed + getExplore).

**Issues found:**
- searchVideos — 108-162KB raw API bloat (22KB/item with 30+ junk fields per video)
- searchUsers — returned empty `{"status_code":0}` (raw HTTP path, no API intercept)
- getVideoComments — returned empty (comment section lazy-loads, 500px scroll insufficient)
- getHashtagVideos — returned empty (API intercept pattern too narrow)
- getHashtagDetail — bloated with profileLarger/Medium/Thumb URLs, shareMeta, extra, log_pb
- format: uri — noisy validation warnings on every adapter-routed op

**Fixes (adapter + spec):**
- Route searchVideos through adapter — intercept on search page, normalize via `normalizeVideoItem()` (108KB → 12.7KB)
- Route searchUsers through adapter — navigate to `/search/user?q=`, intercept + trim user_info
- Route getHashtagDetail through adapter — trim to challenge id/title/desc/stats only
- Fix getVideoComments — click `[data-e2e="comment-icon"]` to trigger lazy-loaded comment API, progressive scroll fallback
- Fix getHashtagVideos — broaden intercept patterns (`/api/search/item/`), add SSR `webapp.challenge-detail` fallback, scroll 3 steps
- Add `scrollSteps` option to `interceptApi` for progressive scrolling
- Remove all `format: uri` from openapi.yaml (eliminates validation warnings)

**Verification:** searchVideos PASS (12.7KB trimmed), searchUsers PASS (10 users), getHashtagDetail PASS (trimmed), getVideoComments PASS (20 comments), getHashtagVideos PASS (30 items), getHomeFeed PASS, getExplore PASS, getUserProfile PASS, getVideoDetail PASS, getUserVideos PASS.

**Key files:** `src/sites/tiktok/adapters/tiktok-web.ts`, `src/sites/tiktok/openapi.yaml`

## 2026-04-17 — Adapter Refactor

**Context:** Phase 5C normalization — migrate site adapters from the legacy `CodeAdapter` shape (with `init`/`isAuthenticated`/`execute`) to the leaner `CustomRunner` shape (single `run(ctx)`).
**Changes:** `src/sites/tiktok/adapters/tiktok-web.ts` migrated to `CustomRunner` (588 → 572 lines). Dropped `init()` (only checked `page.url().includes('tiktok.com')`, redundant with PagePlan) and `isAuthenticated()` (hardcoded `return true`). 21 ops dispatched via `OPERATIONS` table; signing infra, `interceptApi`, `internalApiCall`, `ensureTikTokPage`, and CSRF token extraction preserved byte-for-byte.
**Verification:** 12/12 ops PASS.
**Key files:** `src/sites/tiktok/adapters/tiktok-web.ts` (commit b8bf85f).

## 2026-04-10: Write ops + getExplore (9 new operations)

**What changed:**
- Added 8 write ops: likeVideo, unlikeVideo, followUser, unfollowUser, bookmarkVideo, unbookmarkVideo, createComment, deleteComment
- Added 1 read op: getExplore — trending videos from Explore page
- Write ops use `internalApiCall` helper — in-browser fetch to TikTok internal APIs with form-encoded bodies
- All write ops: `permission: write`, `safety: caution`
- Created 9 example JSON files (8 `unsafe_mutation` + 1 `safe_read`)
- Updated DOC.md with new workflows, ops table, quick-start examples

**Why:**
- TikTok had only read ops — agents couldn't perform social interactions

**Verification:** `pnpm build` PASS; getExplore PASS; write ops skipped by verify (unsafe_mutation); getUserProfile/getVideoDetail FAIL (pre-existing `__name` issue)

## 2026-04-06: Fix verify — add example fixtures and manifest

**What changed:**
- Created `examples/searchVideos.example.json` with test case (keyword: "cooking")
- Created `manifest.json` with site metadata
- Verify was failing because no example fixtures existed — verify requires `examples/*.example.json` files with `cases` array to run test cases
- Installed fixtures to `$OPENWEB_HOME/sites/tiktok/` (resolver priority 1)

**Why:**
- Verify returned FAIL with empty operations list — the examples directory was missing entirely
- The site resolver checks `$OPENWEB_HOME/sites/` before `src/sites/`, so fixtures must exist in the installed location

**Verification:** `openweb verify tiktok --browser` → PASS (searchVideos: PASS)

## 2026-04-06: Initial site package

**What changed:**
- TikTok site package with 1 operation: searchVideos
- Page transport required — heavy bot detection (X-Bogus, X-Gnarly, msToken computed client-side)
- cookie_session auth, no CSRF for read operations
- Search returns video metadata: id, description, author, stats, video/music URLs, hashtags

**Why:**
- TikTok's anti-bot signing prevents node transport
- Single search endpoint covers primary discovery intent
