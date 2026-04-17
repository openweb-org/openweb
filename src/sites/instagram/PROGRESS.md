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
