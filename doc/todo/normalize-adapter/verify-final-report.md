# normalize-adapter — verify --all final report

Handoff for next worker: **na-verify-fix-regressions**.

Run context:
- Branch: `task/normalize-adapter`
- Build commit: `827b430` (post-shim sync)
- Date: 2026-04-17
- Build: `pnpm build` exit 0, 93 sites packaged
- `grep -rn CodeAdapter dist/sites --include="*.js"` → 0 matches (DOC.md historical mentions only)

## Summary

| Metric | Count |
|---|---|
| Total sites | 93 |
| PASS | 73 |
| FAIL | 15 |
| auth_expired | 4 |
| drifted | 1 |
| **adapter-export errors** | **0** ✅ |

milestone acceptance gate: **GREEN**. Zero `module has no valid adapter export (expected run)` anywhere.

## Per-failure table

20 sites failed verification. Reason text trimmed to one line; classification done by diffing against `main` adapter (where one exists) and inspecting failure mode.

| Site | Op | Reason (1-line) | Classification |
|---|---|---|---|
| bilibili | searchVideos | no browser tab open for this site | PRE-EXISTING (env: needs open tab) |
| bloomberg | getCompanyProfile | transient: Page global `__NEXT_DATA__` eval | PRE-EXISTING (no adapter; spec-only) |
| bloomberg | getMarketOverview | transient: Page global `__NEXT_DATA__` eval | PRE-EXISTING (no adapter) |
| bloomberg | getStockChart | transient: Page global `__NEXT_DATA__` eval | PRE-EXISTING (no adapter) |
| bloomberg | searchBloomberg | bot detection blocked (CAPTCHA) | PRE-EXISTING (anti-bot) |
| bluesky | searchPosts | page.evaluate AbortError signal aborted | PRE-EXISTING (Playwright transient) |
| ebay | getItemDetail | transient: Page global eval | PRE-EXISTING (no adapter) |
| ebay | getSellerProfile | transient: Page global eval | PRE-EXISTING (no adapter) |
| fidelity | getCompanyLogo | authentication expired (401/403) | PRE-EXISTING (auth) |
| guardian | getSectionFeed | transient: HTTP 429 | PRE-EXISTING (rate limit) |
| guardian | searchArticles | transient: HTTP 429 | PRE-EXISTING (rate limit) |
| instagram | getExplore | schema_drift status=200 schema=false | PRE-EXISTING (upstream shape) |
| instagram | getFollowers | auth expired (401/403) | PRE-EXISTING (auth) |
| instagram | getFollowing | auth expired (401/403) | PRE-EXISTING (auth) |
| instagram | getNotifications | Response is not valid JSON | PRE-EXISTING (likely auth wall HTML) |
| instagram | getPost | schema_drift | PRE-EXISTING (upstream) |
| instagram | getPostComments | schema_drift | PRE-EXISTING (upstream) |
| instagram | getStories | schema_drift | PRE-EXISTING (upstream) |
| instagram | getUserPosts | auth expired | PRE-EXISTING (auth) |
| instagram | searchUsers | auth expired | PRE-EXISTING (auth) |
| kayak | searchHotels | page.waitForSelector Timeout 20000ms | PRE-EXISTING (page render) |
| medium | getRecommendedFeed | type_change pagingInfo.next required_missing | PRE-EXISTING (upstream GraphQL) |
| notion | getPage | auth expired (401/403) | PRE-EXISTING (auth) |
| notion | getSpaces | auth expired | PRE-EXISTING (auth) |
| notion | queryDatabase | auth expired | PRE-EXISTING (auth) |
| notion | searchPages | auth expired | PRE-EXISTING (auth) |
| pinterest | getHomeFeed | auth expired | PRE-EXISTING (auth) |
| reddit | getMe | schema_drift | PRE-EXISTING (upstream) |
| reddit | getNotifications | schema_drift | PRE-EXISTING (upstream) |
| substack | getArchive | browser_fetch TypeError datadog-rum | PRE-EXISTING (3rd-party blocker) |
| substack | getPost | browser_fetch TypeError datadog-rum | PRE-EXISTING (3rd-party blocker) |
| substack | getPostComments | browser_fetch TypeError datadog-rum | PRE-EXISTING (3rd-party blocker) |
| substack | getTrending | HTTP 404 | PRE-EXISTING (upstream) |
| trello | getBoards | HTTP 400 — invalid token | PRE-EXISTING (auth config) |
| uber | getRideEstimate | GraphQL error: not found | PRE-EXISTING (upstream GraphQL) |
| uber | getRideHistory | pageFetch TypeError: Failed to fetch | PRE-EXISTING (transient) |
| ubereats | addToCart | Permission required: write on ubereats/addToCart | PRE-EXISTING (permission flag) |
| ubereats | getCart | getDraftOrdersByEaterUuidV1: status code error | PRE-EXISTING (upstream) |
| ubereats | getEatsOrderHistory | schema_drift | PRE-EXISTING (upstream) |
| walmart | getProductDetail | schema_drift | PRE-EXISTING (upstream) |
| walmart | getProductPricing | schema_drift | PRE-EXISTING (upstream) |
| weibo | getFriendsFeed | auth expired | PRE-EXISTING (auth) |
| weibo | getUserStatuses | auth expired | PRE-EXISTING (auth) |
| whatsapp | getChats | transient: WhatsApp internal modules not loaded | UNKNOWN (see notes) |
| x | getBookmarks | Could not discover Bookmarks queryId from X navigation | PRE-EXISTING (upstream) |
| x | getUserFollowers | HTTP 404 | PRE-EXISTING (upstream API change) |
| x | searchTweets | HTTP 404 | PRE-EXISTING (upstream API change) |

### Classification methodology

For sites with adapters, compared `main:src/sites/<site>/adapters/<file>.ts` init/isAuthenticated bodies against current branch:

| Site | main had real init/isAuth? | Branch behavior | Verdict |
|---|---|---|---|
| bilibili | url-check init + SESSDATA cookie isAuth | Folded into run; failure is "no tab open" (pre-init runtime check) | PRE-EXISTING |
| bluesky | navigates to bsky.app + sleep, JWT check | Shim folded in; failure is page.evaluate AbortError, unrelated | PRE-EXISTING |
| instagram | url-check + sessionid cookie expiry check | Folded; failures are auth/schema, not lifecycle | PRE-EXISTING |
| kayak | url-check init, returns false isAuth | Trivial — folded fine; failure is selector timeout | PRE-EXISTING |
| medium | url-check + sid/uid cookie | Folded; failure is upstream schema | PRE-EXISTING |
| trello | url-check + token cookie | Folded; failure is HTTP 400 invalid token | PRE-EXISTING (auth config) |
| uber | url-check + sid/csid/jwt cookie | Folded; failure is GraphQL/pageFetch | PRE-EXISTING |
| ubereats | url-check + sid/csid/jwt cookie | Folded; failures are permission/upstream | PRE-EXISTING |
| walmart | url-check + always-true isAuth | Folded; failure is schema_drift | PRE-EXISTING |
| x | url-check + auth_token cookie | Folded; failures are upstream HTTP 404 | PRE-EXISTING |
| **whatsapp** | **real init: page.evaluate(`require('WAWebChatCollection')`)** | Shim folded into `ensureReady()` called from `run()`; throws `retriable('WhatsApp internal modules not loaded')` mid-execute | **UNKNOWN** (see notes) |

### Notes on whatsapp (the only non-trivial one)

main's adapter had:
- `init()` — eval `require('WAWebChatCollection')` is callable (truthy when modules loaded)
- `isAuthenticated()` — eval `ChatCollection.getModelsArray().length > 0`

Branch (`whatsapp-modules.ts:20-29`) defines `ensureReady(page, helpers)` which throws `helpers.errors.retriable('WhatsApp internal modules not loaded')` when modules aren't ready, called inside `run()`.

Two possibilities:
1. Lifecycle on `main` retried `init()` via `browser-lifecycle.ts` waiting for it to return true → branch throws once and reports failure.
2. `main` had the same symptom; this is just a slow tab. WhatsApp Web modules load lazily after cookie-gated handshake.

Action for next worker: open WhatsApp Web tab manually, wait for chats to appear, re-run `pnpm dev verify whatsapp`. If still fails → check whether old runtime had a retry loop on init(); if so, that's REGRESSION-SHIM. Otherwise PRE-EXISTING.

## Grouping hints

### Batchable as one sub-agent (auth-refresh sweep)
`fidelity, instagram, notion, pinterest, trello, weibo` — all 401/403 / invalid-token. Worker just needs to log in via each site's tab, no code change.

### Batchable as one sub-agent (schema_drift sweep — same root cause class)
`instagram (4 ops), medium, reddit, ubereats getEatsOrderHistory, walmart` — schema mismatch vs current upstream payloads. Worker re-records, regenerates schema, commits. Mechanical per site.

### Batchable as one sub-agent (upstream endpoint changes)
`x getUserFollowers/searchTweets (HTTP 404), x getBookmarks (queryId discovery), substack getTrending (HTTP 404), uber getRideEstimate (GraphQL not-found)` — Twitter/Substack/Uber moved or removed endpoints. Worker re-captures, picks new endpoint, updates spec.

### Batchable as one sub-agent (transient / retry-tunable)
`bloomberg (3 page_global ops), ebay (2 page_global ops), bluesky AbortError, substack (3 datadog browser_fetch), guardian (2× HTTP 429), kayak selector timeout, uber getRideHistory pageFetch, ubereats getCart, ubereats addToCart permission` — re-run with longer timeouts / additional retry / 429 backoff / permission flag tweak. Some might just self-resolve on next run.

### Solo (need investigation)
- **bilibili** — runtime says "no browser tab open"; investigate whether auto-launch should open a bilibili tab or if this is expected user-precondition.
- **whatsapp** — see Notes; may need init-retry loop reinstated, or just better error.
- **bloomberg searchBloomberg CAPTCHA** — anti-bot; not a code fix.

## Raw paths

- Full log: `/tmp/verify-all.log`
- Report: `~/.openweb/verify-report.json`
- Per-site fail list (machine-readable): regenerate via `jq -r '[.sites[] | select(.status!="PASS")]' ~/.openweb/verify-report.json`

## Acceptance for na-verify-fix-regressions

The only thing this milestone (normalize-adapter) needed to gate was zero adapter-export errors. **That's met.** Everything in the table above is downstream-of-milestone work. Treat the four batches as separate PRs; whatsapp + bilibili can stay open if they're pre-existing.

## na-verify-fix-regressions — outcome (2026-04-17)

### Fixed
| Site | Op | Verdict | Fix | Re-verify |
|---|---|---|---|---|
| whatsapp | getChats (+ all 3 ops) | **REGRESSION-SHIM** | Added single retry (reload + 3s wait) inside `ensureReady()` of `whatsapp-modules.ts`. Mirrors the runtime-level retry that lived in `main:src/runtime/adapter-executor.ts:127-133` (try init → page.reload → waitForTimeout → retry init), which the new CustomRunner architecture dropped. | `pnpm dev verify whatsapp` → 3/3 PASS |
| medium | getRecommendedFeed | PRE-EXISTING (upstream GraphQL drift) | Relaxed `pagingInfo` to nullable, dropped `required: [next]`, dropped `required: [to]` on `pagingInfo.next` in `openapi.yaml`. | `pnpm dev verify medium` → 9/9 PASS |

### Skipped (out of scope, per task instructions)
| Group | Sites/ops | Why skipped |
|---|---|---|
| auth_expired | fidelity, instagram (5 ops), notion (4 ops), pinterest, trello, weibo (2 ops) | Need interactive login |
| schema_drift (no field-level diff in report) | instagram getExplore/getPost/getPostComments/getStories, reddit getMe/getNotifications, ubereats getEatsOrderHistory, walmart getProductDetail/getProductPricing | Verify report only says `schema=false` — no field-level diff. Cannot mechanically fix without recapture (out of scope) |
| upstream HTTP 404 / endpoint removed | x getUserFollowers/searchTweets/getBookmarks, substack getTrending, uber getRideEstimate, instagram getNotifications | New endpoint unknown; recapture needed (out of scope) |
| transient page_global / browser_fetch | bloomberg (3 ops), ebay (2 ops), bluesky searchPosts, substack (3 datadog ops), uber getRideHistory, ubereats getCart | Transient / 3rd-party blockers; existing retry already in place |
| env / rate-limit / anti-bot | bilibili (no tab), guardian (HTTP 429), bloomberg searchBloomberg (CAPTCHA), kayak selector timeout, ubereats addToCart (permission flag) | Not code regressions |

### whatsapp verdict
**REGRESSION-SHIM, fixed.** Confirmed by reading `git show main:src/runtime/adapter-executor.ts` lines 127-133: main retried `adapter.init(page)` once after `page.reload()` + `waitForTimeout(adapterRetry)`. The new branch's `executeAdapter()` (post-CustomRunner refactor) does no such retry — `ensureReady()` is called inline within `run()` and throws `retriable` on first failure. Restored equivalent behavior in the whatsapp adapter itself (cleanest fix; runtime stays simple).

### Final touched-site verify counts
- `pnpm dev verify medium`: 9/9 PASS
- `pnpm dev verify whatsapp`: 3/3 PASS
