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
