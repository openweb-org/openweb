## 2026-04-18 — Write-Verify Campaign

**Context:** First end-to-end exercise of write ops via `pnpm dev verify pinterest --write`.
**Changes (`829629e`):** Confirmed write ops use form-encoded bodies (`source_url` + JSON-string `data` fields) on POST `/resource/{ResourceName}/{create,delete}/`. Refreshed `savePin` example.
**Verification:** 1/4 write ops PASS (`savePin`). 3 BLOCKED:
- `unsavePin` — `PinResource/delete/` needs the saved-pin record `id` from `savePin` response (not the original `pin_id`). No `${prev.<op>}` cross-op templating in verify. Architectural gap; see handoff §4.1.
- `followBoard` / `unfollowBoard` — Pinterest retired `BoardFollowResource`; modern flow is GraphQL persisted-query. Needs `doc_id` discovery via fresh HAR.

**Key discovery:** Pinterest is the canonical example of the **cross-op response-templating gap**. Adding `${prev.savePin.id}` syntax to verify example.json would unlock pinterest's last write op plus removeFromCart for doordash/target/costco — single architectural change for 5+ sites.
**Pitfalls encountered:** "It worked once" doesn't mean savePin is robust — Pinterest has aggressive rate-limiting + bot detection. CSRF and `x-pinterest-pws-handler` must be fresh per call.

---

## 2026-04-10: Write ops + feed/notifications (6 new ops)

**What changed:**
- Added 4 write ops: `savePin`, `unsavePin`, `followBoard`, `unfollowBoard` with `permission: write`, `safety: caution`
- Added 2 read ops: `getHomeFeed` (personalized feed via `UserHomefeedResource`), `getNotifications` (activity via `NewsHubResource`)
- Write ops use POST to `/resource/{ResourceName}/create/` or `/resource/{ResourceName}/delete/`
- Created 6 example files (4 `unsafe_mutation`, 2 `safe_read`)
- Expanded DOC.md with new workflows and ops table

**Why:**
- Agents could only search and read — couldn't save pins, follow boards, or see their feed

**Verification:** `pnpm build` PASS; `pnpm dev verify pinterest --browser` — PASS (7/7 read ops; 4 write ops skipped as unsafe_mutation)

---

## 2026-04-01: Initial discovery and compilation

**What changed:**
- Discovered Pinterest resource API pattern (`/resource/{ResourceName}/get/`)
- Compiled 5 operations: searchPins, getPin, getBoard, getUserProfile, searchTypeahead
- Set page transport (Pinterest bot detection blocks node)
- Configured cookie_session auth with csrftoken CSRF
- Added Pinterest-specific headers as const parameters (x-requested-with, x-pinterest-appstate, etc.)

**Why:**
- First discovery of Pinterest site package
- Pinterest has aggressive bot detection requiring page transport and custom headers

**Verification:** page transport with browser, search confirmed working via page.evaluate(fetch)
