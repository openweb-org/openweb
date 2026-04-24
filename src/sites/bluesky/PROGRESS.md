## 2026-04-24 — Response trimming adapters (QA userflow)

**Context:** Userflow QA across 3 personas (researcher, early adopter, journalist) found all 10 read ops functional but response bloat caused 4/10 to truncate to temp files. Root cause: raw AT Protocol responses include full author objects (associated, verification, viewer, labels), duplicate embed data (record.embed blob refs + embed view), and deeply nested reply trees.

**Changes:**
- **New `bluesky-public.ts` adapter** — CustomRunner using `nodeFetch` for 8 public API ops (getProfile, getPostThread, getFeed, getAuthorFeed, searchActors, getFollowers, getFollows, getPosts). Trims authors to essentials (did, handle, displayName, avatar, description, counts, verifiedStatus). Strips record.embed duplicates. Simplifies embed views. Caps thread replies at 30 with `repliesTruncated` count. Feed reply context uses lightweight refs (handle, text preview, URI).
- **Updated `bluesky-pds.ts` adapter** — Added trimming to searchPosts (posts → trimPost) and getNotifications (notifications → trimNotification). Write ops unchanged.
- **Updated `openapi.yaml`** — Added `adapter: { name: bluesky-public, operation: <op> }` to all 8 public API operation x-openweb blocks.

**Results (limit=3 unless noted):**
| Operation | Before | After | Inline? |
|-----------|--------|-------|---------|
| getProfile | ~1.3KB | 783b | Yes |
| searchActors | ~1.5KB | 2.2KB | Yes |
| getAuthorFeed | 9.2KB truncated | 3.9KB | Yes |
| getFeed | ~6KB inline | 3.5KB | Yes |
| getFollowers | ~2KB | 1.2KB | Yes |
| getFollows | ~3KB | 3KB | Yes |
| getPosts | ~1.5KB | 1.1KB | Yes |
| getPostThread | 334KB truncated | 35KB file | Expected (198→30 replies) |
| searchPosts | 8.7KB truncated | 2.5KB | Yes |
| getNotifications | ~3KB | 2.9KB | Yes |

**Key files:** `src/sites/bluesky/adapters/bluesky-public.ts`, `src/sites/bluesky/adapters/bluesky-pds.ts`, `src/sites/bluesky/openapi.yaml`

## 2026-04-20 — Restored from .skip after handoff4 quarantine (handoff5)

**Context:** Handoff4 left bluesky in `openapi.yaml.skip` overnight with all ops in a "login-loop" failure mode — every read op landed in the auth cascade despite the underlying account being valid.
**Changes:** No spec or adapter changes. Cookies refreshed by running `openweb browser stop` → `pkill -9 -f openweb-profile-` → `openweb browser start`, which copies a fresh cookie set from the default Chrome profile per `src/commands/browser.ts:267-285`. `openapi.yaml.skip` renamed back to `openapi.yaml`.
**Verification:** `pnpm dev verify bluesky --browser --write` 22/22 PASS.
**Key discovery:** "Login-loop" failures across bluesky/instagram/x in handoff4 had a single shared cause — a stale managed-Chrome cookie set, not real per-site auth bugs. The `browser stop+start` cascade is the canonical unblocker; reach for it before suspecting site code.

## 2026-04-01: Initial discovery and compilation

**What changed:**
- Discovered Bluesky AT Protocol API at public.api.bsky.app
- 9 operations: getProfile, getAuthorFeed, getPostThread, getFeed, searchPosts, searchActors, getFollowers, getFollows, getPosts
- Manual spec curation required — compiler path normalization merged all XRPC methods into single parameterized endpoint
- Public API (no auth) for 8/9 operations; searchPosts requires auth (403)

**Why:**
- Net-new site discovery targeting user-requested operations (getFeed, getPost, getProfile, searchPosts, getNotifications)
- getNotifications excluded — requires auth not available on public API

**Verification:** Runtime verify 8/9 public operations pass, searchPosts expected 403
**Commit:** pending

## 2026-04-17 — Adapter Refactor

**Context:** Phase 5C normalization — migrate bluesky-pds adapter from legacy `CodeAdapter` lifecycle (`init`/`isAuthenticated`/`execute`) to the simpler `CustomRunner` (`run(ctx)`) shape.
**Changes:**
- `src/sites/bluesky/adapters/bluesky-pds.ts`: 297 → 272 lines, single `run(ctx)` entry dispatching via an `OPERATIONS` table.
- Dropped `init()` (only navigated to bsky.app — redundant with PagePlan).
- Dropped `isAuthenticated()` (pure localStorage read couldn't validate server state); `requireSession` already throws `errors.needsLogin()` and `pdsGet`/`pdsPost` surface token errors.
- Collapsed per-op top-level consts into the `OPERATIONS` table; all 14 operations preserved byte-for-byte.
**Verification:** 10/10 ops PASS.
**Key files:** `src/sites/bluesky/adapters/bluesky-pds.ts`
