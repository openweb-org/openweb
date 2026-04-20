## 2026-04-19 — HMAC unvote/delete ops

**Context:** HN HMAC probe to add the missing inverse ops (`unvoteStory`, `deleteComment`) so every write op has a clean rollback partner. Per write-verify handoff §5.5, the HN HMAC was an unknown — fallback was to drop all 4 HN write ops if the token model was incompatible with verify's session.

**Changes:**
- 2 new ops: `unvoteStory` (hn0017), `deleteComment` (hn0018, `permission: delete`)
- `addComment` adapter now returns `{ok, parent, id}` by re-fetching `/threads?id={user}` after POST and parsing the first `<tr class="athing comtr" id="...">` — enables `${prev.addComment.id}` chaining
- `unvoteStory` scrapes `#un_{id}` href (same per-(user, item) HMAC as upvote, but only rendered while currently upvoted)
- `deleteComment` does GET `/delete-confirm` → parse hidden hmac → POST `/xdelete` form-encoded
- 2 chained pairs restored: `upvoteStory(order:1)` → `unvoteStory(order:2)`; `addComment(order:1)` → `deleteComment(order:2)`
- DOC.md: documented HMAC scraping, `addComment` id-discovery via `/threads`, `/xdelete` endpoint pitfall

**Verification:** `pnpm dev verify --site hackernews --browser --write` — **18/18 PASS** (14 reads + 4 writes)

**Key discovery:** HN's delete endpoint is `/xdelete`, not `/delete`. The obvious URL returns 404; the canonical source is `form[action="/xdelete"]` inside `/delete-confirm`. Do not infer the submit endpoint from the path of the confirm step.

**Pitfalls encountered:**
- `safety` enum is `safe | caution` only (validator in `src/types/validator.ts`). `destructive` looks plausible but fails x-openweb validation, which then poisons every read op in the same site (all 14 returned the same enum error before this was fixed).
- HN's POST `/comment` response gives no comment id, so chained delete required an extra `/threads` round-trip. The same pattern likely applies to other classic form-redirect sites where the create response is just an HTML redirect to the parent.

---

## 2026-04-14: Transport upgrade — adapter read ops from page to node

**What changed:**
- Upgraded 4 adapter read ops (getStoryComments, getStoriesByDomain, getUserSubmissions, getUserComments) from `transport: page` to `transport: node`
- Removed per-operation `servers:` blocks with `transport: page` + `auth: cookie_session` — these ops hit public Algolia API, no auth needed
- Added `transport: node` to each operation's `x-openweb` block — executor passes `page: null` to adapter, skips browser entirely
- Updated adapter function signatures from `Page` to `Page | null`
- Bumped `tool_version` to 3 for all 4 ops
- All 14 read ops now run on node transport; only 2 write ops remain on page transport

**Why:**
- Adapter read ops were already using Node `fetch()` to Algolia (no DOM), but `transport: page` forced unnecessary browser startup (~5s overhead per call)

**Verification:** `pnpm dev verify hackernews` — 14/14 PASS, all ops on node transport

---

## 2026-04-10: Add upvoteStory and addComment write ops

**What changed:**
- Added 2 write operations: `upvoteStory`, `addComment`
- Both use adapter with form-based submission via `page.evaluate()` + `fetch()` in browser context
- `upvoteStory` navigates to item page, extracts vote auth token from `#up_{id}` link href, issues GET
- `addComment` navigates to item page, extracts HMAC from comment form hidden input, POSTs to `/comment`
- Both set `permission: write`, `safety: caution`
- Created 2 example JSON files with `replay_safety: unsafe_mutation`
- Updated DOC.md with upvote/comment workflows, ops table, quick-start examples
- Updated manifest.json operation count 14 → 16

**Why:**
- Agents need write capability — upvoting and commenting are the two primary HN write interactions

**Verification:** `pnpm build` ✓, `pnpm --silent dev verify hackernews --browser` — 10/10 read ops PASS, write ops skipped by verify

---

## 2026-03-31: Curate to 14 operations, page transport, DOC polish

**What changed:**
- Added 4 operations: getNewComments, getStoriesByDomain, getUserSubmissions, getUserComments
- Changed transport from `node` to `page` (cookie_session) — DOM extraction requires browser
- Enriched all summaries with 3-5 key response fields per spec-curation standards
- Added `$ref` component schemas (FeedStory, Comment) to eliminate duplication
- Added descriptions to all schema properties
- Created 10 example fixtures (up from 1)
- Rewrote DOC.md per site-doc.md template: workflows, operations table with `← source`, quick start

**Why:**
- Spec curation pass (compile.md Step 3) to meet verify exit gate across all three dimensions

**Verification:** `pnpm --silent dev verify hackernews` — runtime, spec, doc

---

## 2026-03-26: Expand from 1 to 10 operations

**What changed:**
- Added 9 new operations: getNewestStories, getBestStories, getAskStories, getShowStories, getJobPostings, getFrontPageStories, getStoryDetail, getStoryComments, getUserProfile
- Created adapter (`adapters/hackernews.ts`) for parameterized operations (story detail, comments, user profile)
- Added `age` field to existing getTopStories operation
- Used shared component schema for feed operations
- Updated DOC.md with full operation table and architecture notes

**Why:**
- Site coverage audit identified hackernews as HIGH priority (1 op, missing obvious core functionality)
- 10 operations now cover: all feed types, story detail with comments, user profiles

**Verification:** Manual exec verification of all 10 operations via `openweb hackernews exec`. Feed pages return 30 items each. Story detail returns full comment tree with nesting. User profile returns username/karma/created/about.

---

## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 1 verified operation using DOM extraction pattern

**Verification:** spec review only — no new capture or compilation

---

## 2026-04-19 — Fixture refresh: upvoteStory

**Context:** `upvoteStory` example pinned to a stale story id (42407357), causing intermittent verify failures when HN cycled the story off the front page (vote tokens are scoped per-(user, item, time-window)).
**Changes:** `examples/upvote_story.example.json` retargeted to id `47828896` (current top of HN front page at time of edit). No adapter or spec changes. Companion edit: `order: 1` field added so a future paired `unvoteStory` can chain via `${prev.upvoteStory.id}` per the new SKILL.md workflow.
**Verification:** 1/1 PASS — `pnpm dev verify hackernews --ops upvoteStory --browser --write`.
**Pitfalls encountered:** Verify dispatches against the registry-installed copy at `$OPENWEB_HOME/sites/hackernews/`, not `src/sites/hackernews/` directly — edits to the source tree must be mirrored into the install for in-loop verification (or rely on the next package install to propagate).
