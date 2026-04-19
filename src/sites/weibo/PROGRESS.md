## 2026-04-18 — Write-Verify Campaign

**Context:** First end-to-end exercise of write ops via `pnpm dev verify weibo --write`.
**Changes (`0dbc7f8`):**
- `likePost`: switched `application/json` → `application/x-www-form-urlencoded`. `/ajax/statuses/setLike` rejects JSON with "parameter (id) value invalid".
- Refreshed example fixtures: write ops now use **numeric long `mid`** (e.g. `5289345339621625`) instead of alphanumeric `mblogid` (e.g. `Qyj0ifs0m`). setLike requires the long form.
- Paired likePost/unlikePost (order:1/2) so unlike runs against state set by like.
- Added missing `repost` example.
- Relaxed `retweeted_status` sub-schema (drop required[id,idstr,mid] + user.required) — real responses vary.
- **Removed examples** for `unbookmarkPost`, `unfollowUser`, `bookmarkPost`, `followUser`: `/ajax/statuses/destroyFavorites` and `/ajax/friendships/destroy` now return HTTP 404 upstream. Pair-mates dropped for symmetry to avoid leaking permanent state.

**Verification:** 3/7 write ops PASS (`likePost`, `unlikePost`, `repost`). 4 BLOCKED on upstream HAR re-capture.
**Key discovery:** Weibo's `/ajax/*` write endpoints follow a **form-encoded + numeric-long-id convention** — the JSON-body assumption from compile-time defaulting is wrong for this site family. Documented in DOC.md Known Issues for future ops.
**Pitfalls encountered:** When verifying a 404, distinguish *renamed endpoint* (need fresh HAR) from *resource gone* (op should be removed entirely). For weibo here it's the former — endpoints exist in the UI, just at unknown paths.

---

## 2026-04-18: Drop weibo-web adapter — runtime now preserves Origin in browser_fetch

**What changed:**
- Deleted `src/sites/weibo/adapters/weibo-web.ts` (~225 LOC)
- Stripped `x-openweb.adapter` blocks from all 16 ops; ops now use declarative `transport: page` + `csrf: cookie_to_header` from server config
- Updated `DOC.md § Transport` — adapter section removed

**Why:**
- The L3 adapter existed only to bypass `Origin: null` from runtime's about:blank iframe trampoline (weibo CSRF rejects null Origin with 403 → `auth_expired`).
- Runtime fix in `browser-fetch-executor.ts` now tries `window.fetch` first (real Origin = `https://weibo.com`), falls back to the iframe path only on `TypeError: Failed to fetch` (page-script fetch monkey-patching).

**Verification:** verify weibo --browser → 8/8 PASS (matches prior baseline with adapter).

## 2026-04-02: Fix malformed schemas (Ajv compilation)

**What changed:**
- Fixed `pic_ids.items` — malformed YAML `type: type: object` → `type: string`
- Fixed `pic_infos.additionalProperties` — replaced broken nesting with typed image object (thumbnail/bmiddle/large/original)
- Fixed `retweeted_status` — inlined cycle-broken post schema with basic properties instead of bare `type: object`

**Why:**
- 8/14 operations failed Ajv compilation due to malformed schemas from prior $ref inlining
- Bare `type: object` on retweeted_status violated spec verify rules

**Verification:** 14/14 Ajv compile pass. Runtime verify pending (page transport, needs CDP browser).

## 2026-04-01: Enrich response schemas

**What changed:**
- Replaced 15 bare `type: object` response schemas with `$ref` to WeiboPost/WeiboUser or inline properties
- Added properties to: tabList items, sunshine_credit, education, url_struct items
- Component schemas (WeiboPost.user, WeiboPost.retweeted_status) now use `$ref`

**Why:**
- Spec Verify requires no bare `type: object` for ops returning structured JSON
- Agents need typed schemas to understand response shapes without runtime probing

**Verification:** Spec Verify pass, Doc Verify pass. Runtime Verify pending (page transport, no browser available).

## 2026-03-29: Initial compile

**What changed:**
- 14 operations: 6 read feeds/posts, 4 user/profile, 4 write (like, repost, follow, bookmark)
- Page transport with cookie_session auth + XSRF-TOKEN CSRF
- Full adapter (weibo-web.ts) for all operations
- DOC.md with 4 workflows, operations table, quick start

**Why:**
- Initial site package for Weibo (China's Twitter/X equivalent)

**Verification:** Compiled from HAR capture. Runtime verified with browser session.

## 2026-04-13 — Schema Fix

**Context:** `retweeted_status` fields are omitted when the original retweet has been deleted by the author.
**Changes:** openapi.yaml — relaxed `required` on `retweeted_status` object properties.
**Verification:** Verify pass — schema now handles both present and deleted retweet cases.

## 2026-04-17 — Phase 3 Pure-Spec Migration

**Context:** Phase 3 of normalize-adapter.
**Changes:** All 6 write ops (bookmarkPost, followUser, repost, unbookmarkPost, unfollowUser, unlikePost) moved to pure spec.
- Server-level `cookie_session` auth + `cookie_to_header` CSRF (`XSRF-TOKEN` cookie → `x-xsrf-token` header) already covered the adapter's behavior.
- `repost` uses `application/json` body; the other 5 use `application/x-www-form-urlencoded` — matching the adapter's postJson / postForm split.
- Adapter file deleted (entire `adapters/` directory removed).
**Verification:** `pnpm dev verify weibo` → 6/8 PASS (write ops skipped without `--write`, as expected); 2 read ops are pre-existing `auth_expired` (getFriendsFeed, getUserStatuses).

## 2026-04-18 — L3 Adapter Restored (c8b0f6b)

**Context:** verify-fix-0418 sweep — `pnpm dev verify weibo` showed 0/8 PASS, all classified as `auth_expired (401/403)` despite valid `SUB`/`XSRF-TOKEN`/`sessionid` cookies in the persistent browser.
**Changes:**
- Restored `src/sites/weibo/adapters/weibo-web.ts` as a thin `CustomRunner` over `helpers.pageFetch` for all 16 ops (`/ajax/*`).
- Wired `x-openweb.adapter: { name: weibo-web, operation: <op> }` into every operation in `openapi.yaml`.
**Verification:** 8/8 read ops PASS (`pnpm dev verify weibo`); write ops untested without `--write`.
**Root cause:** Phase 3 routed weibo through the runtime's `browser_fetch` executor, which uses an `about:blank` iframe to obtain a clean `fetch` reference. Opaque-origin iframes emit `Origin: null` + `Sec-Fetch-Site: cross-site`; weibo's CSRF rejects this with HTTP 403, which the runtime classifies as `auth_expired`. `pageFetch` (page-context fetch from a logged-in `weibo.com` page) preserves `Origin: https://weibo.com/`, so cookies + Origin both validate.
**Pitfalls encountered:** The runtime resolves site packages from `~/.openweb/sites/<site>/` BEFORE `src/sites/`, so spec edits must be mirrored to `~/.openweb` for `pnpm dev verify` to pick them up.
**Follow-up:** A runtime-level fix (same-origin trampoline iframe in `browser_fetch`) would make this adapter unnecessary again — see `doc/todo/verify-fix-0418/outcome.md`.
