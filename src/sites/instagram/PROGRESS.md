## 2026-04-24: Userflow QA — response trimming and fixes

**What changed:**
- All 12 read ops moved to adapter-backed with response trimming. Stripped 50–100+ internal fields per response (strong_id__, fbid_v2, client_cache_key, integrity_review_decision, organic_tracking_token, etc.).
- getUserPosts: 110KB→17KB (3 posts). Items trimmed to pk/id/code/media_type/taken_at/caption/like_count/comment_count/image_versions2/video_versions/carousel_media/user.
- getExplore: 739KB→110KB. Fixed schema mismatch — actual API returns `fill_items` + `one_by_two_item.clips.items` not `medias`. Adapter flattens to a single `items[]` array.
- getUserProfile: massive blob→1.5KB. Stripped 40+ internal fields (business_*, guardian_*, transparency_*, edge_mutual_followed_by, etc.).
- getReels: 94KB→11KB. Added `play_count` to trimmed media shape.
- getNotifications: trimmed to counts + notification text/profile/timestamp.
- searchUsers: trimmed user objects, removed `include_reel` header params.
- getFollowers/getFollowing: stripped internal user fields (strong_id__, fbid_v2, account_badges, etc.), stringify `next_max_id` for type consistency.
- getStories/getPostComments/getPost/getFeed: all trimmed.
- Removed all `x-ig-app-id`/`x-requested-with` header parameters from spec — adapter handles internally.
- Updated openapi.yaml response schemas to match trimmed output.

**Why:**
- Blind userflow QA: 3 personas (small business owner: search Nike + browse posts, influencer: profile stats + notifications + followers, travel blogger: search bali + explore + stories + reels). All 12 read ops functional. Main gap: raw Instagram API responses with 50–100+ internal/noisy fields per item, making responses 5–10x larger than useful content.

**Key files:** `src/sites/instagram/adapters/instagram-api.ts`, `src/sites/instagram/openapi.yaml`.
**Verification:** `pnpm dev verify instagram` — 12/12 PASS.

## 2026-04-20 — 24/24 PASS confirmed after cookie refresh (handoff5)

**Context:** Handoff4 read-side regressed because the orphan-Chrome cleanup gap from §3.1 left several ops hitting a dead browser handle. Write-side already-recovered ops from earlier sessions remained intact.
**Changes:** None to spec or adapter. Reads passed cleanly after `pkill -9 -f openweb-profile-` + `openweb browser start` (fresh-cookie cascade from default Chrome profile, same recipe as bluesky/x).
**Verification:** `pnpm dev verify instagram --browser --write` 24/24 PASS — all 12 reads + 12 writes.
**Key discovery:** Instagram is now hermetic across both read and write surfaces; no fixture rot or endpoint drift surfaced this round. The single recurring failure mode is the wrapper-leak orphan-Chrome problem at the verify-framework layer (handoff5 §5.1), not anything site-specific.

## 2026-04-19 — createComment/deleteComment Recovery (12/12 PASS)

**Context:** From handoff2 §1, `createComment`/`deleteComment` (`*.example.json.skip`) initially looked like upstream endpoint drift — `createComment` returned `{id, status:"ok"}` but the paired `deleteComment` 404'd consistently.
**Changes:** (1) Re-targeted fixture from `@instagram` (spam-filter) to `@wangxinyu926`'s recent adidas post `3877961230447408478`; (2) chained `createComment(order:1) → deleteComment(order:2)` via `${prev.createComment.id}` with on-topic comment text per `feedback_hn_comment_text` rule; (3) fixed adapter URL parameter order — endpoint is `/api/v1/web/comments/{media_id}/delete/{comment_id}/`, not `/{media_id}/{comment_id}/delete/`; (4) removed `.skip` suffix on both example files.
**Verification:** `pnpm dev verify instagram --ops createComment,deleteComment --write --browser` → 2/2 PASS as a chained pair (commit `8efd496`). Total IG write-op coverage: 12/12.
**Key discovery:** "Upstream drift" was actually a URL parameter-order bug. The fastest probe path when an API endpoint looks broken is `page.on('request')` on the live CDP-attached browser plus a single user click in the real UI — capturing the actual XHR revealed `delete` belonged *between* the two IDs, not after them. Pure URL-permutation probing without UI capture is much slower and leads down dead ends.
**Pitfalls encountered:** Spent multiple probe cycles on `/api/v1/media/{media}/comment/{comment}/delete/` and `/bulk_delete/` variants — these are mobile-API endpoints (`i.instagram.com`) that redirect to `/accounts/login` when called from a www session, which masks as a "200 with HTML" success. Lesson: a 200 that returns HTML to a JSON request is a redirect, not a success — check `r.url` to detect the auth-wall.

---

## 2026-04-19 — Write-Verify Continuation (10/12 PASS)

**Context:** Picked up the 6 remaining write ops after the 2026-04-18 sweep (block/unblock landed via the polaris GraphQL helper from `32038d9`).
**Changes:** Wired adapter handlers in `instagram-api.ts` for `likePost`, `unlikePost`, `savePost`, `unsavePost`, `createComment`, `deleteComment` — all reuse the existing `postJson` (cookie + csrftoken) flow already proven by `blockUser`. Added `adapter` bindings to each path in `openapi.yaml`. Added `order` (70-100) plus `${prev.createComment.id}` chain to example fixtures so create/delete pair self-cleans, with `comment_text: "test ${now}"` for uniqueness.
**Verification:** like/unlike PASS, save/unsave PASS (each verified pair-by-pair with `pnpm dev verify instagram --write --browser --ops <pair>`).
**Pitfall — `createComment` / `deleteComment` SKIPPED:** The endpoint pattern is correct (`createComment` returns valid `{id, status:"ok"}`), but Instagram's spam filter shadow-deletes test comments on `@instagram` within a few seconds, so the immediate `deleteComment` 404s. Repeated probes to discover the right URL (verified the spec'd path is correct via HTTP probing) tripped IG's account-level write-block, which then cascaded into "Response is not valid JSON" failures across all write ops in a single `verify --all` run. Pair-by-pair runs spaced minutes apart still PASS for like/save. Comments are now `*.example.json.skip` until a low-traffic test target (own post, friend's account) is available — adapter handlers stay in place.
**Outcome:** instagram 10/12 write ops verified PASS.

---

## 2026-04-18 — Write-Verify Campaign


**Context:** First end-to-end exercise of write ops via `pnpm dev verify instagram --write`.
**Changes (`401b5a5`):** Repaired `followUser`/`unfollowUser` by routing to the mobile-API path `/friendships/create/{id}/` (and `/destroy/{id}/`). The legacy `/web/friendships/{id}/follow/` route now returns the SPA HTML shell with HTTP 200, silently breaking JSON parsing.
**Verification:** 4/12 write ops PASS (`followUser`, `unfollowUser`, `muteUser`, `unmuteUser`).
**Key discovery:** When an Instagram web endpoint returns 200 + HTML, the JSON contract is gone — check the mobile-API equivalent before declaring the feature removed.
**Pitfalls encountered:**
- `blockUser`/`unblockUser` — both web and mobile paths now return SPA HTML 200. No working endpoint found through probing common variants. BLOCKED pending fresh HAR.
- The remaining 6 write ops (like/unlike, save/unsave, createComment/deleteComment) were not exercised in this sweep — they have spec/example coverage but PASS status is presumed, not verified.

---

## 2026-04-09: Polish instagram site package (enhanced 4→8 ops)

**What changed:**
- Fixed DOC.md heading levels (Site Internals subsections now `###`)
- Added `required` arrays to all new op response schemas (getUserPosts, getPostComments, getStories)
- Added `description` to all nested objects and properties across 4 new op schemas
- Added `required` arrays on nested items (comment, story item, image rendition, user)
- Created `likePost.example.json` (write op, `unsafe_write` replay safety)
- Added description to likePost status field

**Why:**
- Quality checklist: no bare properties without descriptions, required where data always present, complete examples

**Key files:**
- `openapi.yaml` — schema hardening on getUserPosts, getPostComments, getStories, likePost
- `DOC.md` — heading level fix
- `examples/likePost.example.json` — new

**Verification:** pnpm build, pnpm dev verify instagram

## 2026-04-02: Initial discovery — 4 operations

**What changed:**
- Discovered Instagram REST API v1 endpoints via browser capture
- Compiled: getUserProfile, getPost, getFeed, searchUsers
- Configured page transport (Meta bot detection blocks node)
- Set cookie_session auth with csrftoken CSRF

**Why:**
- Net-new site package for Instagram
- REST v1 endpoints chosen over GraphQL for stability (doc_id hashes change)

**Verification:** compile-time verify shows auth_drift (expected without live browser)

## 2026-04-13 — Auth Fix for getNotifications, getReels, getStories

**Context:** `getNotifications`, `getReels`, and `getStories` returned 401/403 errors because they were missing required Instagram headers (`x-ig-app-id`, `x-requested-with`).
**Changes:** Fixed auth in `adapters/instagram-api.ts` — these operations now route through the adapter's `fetchJson`/`postJson` helpers which inject `IG_HEADERS` (`x-ig-app-id`, `x-requested-with`) and CSRF token. `getReels` uses the adapter's `postJson` for the POST to `/api/v1/clips/user/`.
**Verification:** All three operations authenticate correctly with the shared header injection path.

## 2026-04-14 — Auth Error Handling Overhaul (2/12 → 12/12 verify)

**Context:** `pnpm dev verify instagram` failed 10/12 ops — 5 with `authentication expired (401/403)` and 5 with `schema mismatch`.
**Changes:**
- `adapters/instagram-api.ts`: 401/403 errors now throw `errors.needsLogin()` (retriable) instead of `errors.fatal()`, enabling the auth cascade to refresh credentials
- Added `guardAuthExpired()` to detect Instagram's auth-expired JSON patterns (`login_required`, `checkpoint_required`, `{data: null}`)
- `isAuthenticated()` now checks `sessionid` cookie expiry, not just existence
- Removed `x-ig-www-claim` header — stale claims from copied Session Storage caused 401; Instagram accepts `'0'` (no claim) for all endpoints
- `getCsrfToken()` reads from `document.cookie` (browser JS) instead of CDP cookies to guarantee decrypted values
- `getNotifications` routed through adapter as POST (GET returns 500)
- `openapi.yaml`: notifications `timestamp` type widened to `[string, number]`
- `commands/browser.ts`: copies `Local State` file (contains `os_crypt` encryption key) to temp profile, fixing cookie decryption in managed browser
- `lifecycle/shape-diff.ts`: multi-type schema support (`type: [string, integer]` → `string|number`); skip required checks for children of null nullable ancestors
**Verification:** 12/12 PASS, pnpm build clean, no test regressions
**Key discovery:** Copied Chrome profile cookies are encrypted — `Local State` (in Chrome root, not profile dir) holds the decryption key. Without it, `sessionid` values are ciphertext and auth silently fails.
**Pitfalls encountered:** Sending stale `x-ig-www-claim` from copied Session Storage triggers 401 on POST endpoints; omitting the header entirely (or sending `'0'`) works. Also, `getNotifications` endpoint `/api/v1/news/inbox/` requires POST — GET returns 500 with `{status: "fail"}`.

## 2026-04-17 — CustomRunner Migration (Phase 5B)

**Context:** Phase 5B of the normalize-adapter design introduced `CustomRunner` — a minimal adapter interface with a single `run(ctx)` entry. Instagram chosen as the proof-migration site (smallest permanent-bucket candidate at 261 lines).
**Changes:**
- `adapters/instagram-api.ts`: rewritten as `CustomRunner` (261 → 170 lines). `init()` and `isAuthenticated()` removed — runtime handles via PagePlan (navigation + ready) and the auth-primitive (`cookie_session`) "configured = authenticated" default. Auth validity is still enforced by `guardAuthExpired()` on each fetch, which throws `needsLogin()` on 401/403 / `login_required` payloads.
- Operation handlers unchanged in behaviour; helpers (`fetchJson`, `postJson`, `getCsrfToken`) now receive `AdapterHelpers` directly instead of a custom `Errors` shape.
**Verification:** `pnpm dev verify instagram` → 12/12 PASS.
**Key discovery:** The previous `isAuthenticated` cookie-expiry probe is redundant — the auth-primitive resolver already short-circuits when `sessionid` is absent, and a stale-but-present cookie surfaces immediately as a 401 inside the first real fetch.
