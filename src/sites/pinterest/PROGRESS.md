## 2026-04-19 — Write-Verify Campaign (resolution)

**Context:** Resume of 2026-04-18 work after the verify cross-op templating runtime landed. Goal: take pinterest from 1/4 → 4/4 PASS.
**Changes (`d63e001`):**
- `followBoard` repointed `/resource/BoardFollowingResource/create/` → `/resource/ApiResource/update/` (body `data={"options":{"url":"/v3/boards/<BOARD_ID>/follow/"},"context":{}}`).
- `unfollowBoard` repointed → `/resource/ApiResource/delete/` (same body).
- `unsavePin` example switched `board_id` from a stale hardcoded value to `${prev.savePin.resource_response.data.board.id}` (id field already templated).
- Refreshed `followBoard` / `unfollowBoard` example fixtures to a real public board (`/marthastewart/baking-and-dessert-recipes-and-ideas/`, board id `32088284783993002`).

**Verification:** `pnpm dev verify pinterest --write --browser --ops savePin,unsavePin,followBoard,unfollowBoard` → **4/4 PASS**.

**Key discovery:** The handoff hypothesis ("modern flow is GraphQL persisted-query") was wrong. Pinterest now routes most internal v3 REST calls through a single generic resource: `POST /resource/ApiResource/{create,update,delete,get}/` with `data={"options":{"url":"/v3/...endpoint..."},"context":{}}`. The verb in the wrapper path (`update`/`delete`) maps to the v3 endpoint's HTTP method. When a `*Resource` returns `{"error":{"code":20,"message":"unsupported method create"}}`, the action has been folded into ApiResource — capture a live click to find the wrapped v3 URL.

**Pitfalls encountered:**
- The Follow button is **hidden inside the board's "More actions" 3-dot menu** — the top action bar only shows Share + the menu trigger. Easy to conclude "Pinterest removed board following" when really it just moved.
- Pinterest hides Follow on **self-owned** boards/users. The first board I picked for HAR (`/designmilk/...`) coincidentally matched the logged-in account context; use a clearly third-party account (`marthastewart`, `realsimple`, etc.) for capture.
- Anti-bot serves recaptcha v3 verify pings (`/v3/sessions/verify/`) on board navigation — easily mistaken for a write endpoint. Filter trace/recaptcha/`ApiCResource`/`ApiSResource`/`UserSessionResource`/`ActiveUserResource`/`ActivateExperimentResource`/`UserRegisterTrackActionResource` out of capture noise.
- `--remote-debugging-port=9222` connectivity flaps under load — managed Chrome's idle watchdog kills the process after 5 minutes without a `~/.openweb/browser.last-used` touch. Long discovery scripts should `setInterval` to refresh that file.

---



## 2026-04-18 — Write-Verify Campaign

**Context:** First end-to-end exercise of write ops via `pnpm dev verify pinterest --write`.
**Changes (`829629e`):** Confirmed write ops use form-encoded bodies (`source_url` + JSON-string `data` fields) on POST `/resource/{ResourceName}/{create,delete}/`. Refreshed `savePin` example.
**Verification:** 1/4 write ops PASS (`savePin`). 3 BLOCKED:
- `unsavePin` — `PinResource/delete/` needs the saved-pin record `id` from `savePin` response (not the original `pin_id`). No `${prev.<op>}` cross-op templating in verify. Architectural gap; see handoff §4.1.
- `followBoard` / `unfollowBoard` — Pinterest retired `BoardFollowResource`; modern flow hypothesised as GraphQL persisted-query (later disproven 2026-04-19 — see resolution entry).

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
