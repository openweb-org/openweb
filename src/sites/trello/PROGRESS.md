# Trello — Progress

## 2026-04-09 — Initial package

- Added 5 operations: getBoards, getBoard, getLists, getCards, createCard
- Adapter-based package using `trello-api` adapter for cross-origin REST API calls
- Auth: cookie_session via page transport
- Transport: page (required for cookie forwarding to api.trello.com)

## 2026-04-17 — Adapter Refactor

**Context:** Phase 5C normalization — converge all custom adapters on the shared `CustomRunner` shape so the runtime has a single dispatch path.
**Changes:** `src/sites/trello/adapters/trello-api.ts` migrated from local `CodeAdapter` shim to `CustomRunner` `run(ctx)`. Removed the local interface; imported `CustomRunner`, `PreparedContext`, `AdapterHelpers` from shared types. Replaced `Parameters<CodeAdapter['execute']>[3]` with `AdapterHelpers`. Dropped trivial `init()` (URL check) and `isAuthenticated()` (cookie substring, not a real probe). 330 → 297 lines. Per-op semantics preserved byte-for-byte: same API_BASE, same dsc-cookie body injection for non-GET, same fields/filter, same error shapes.
**Verification:** 1/1 ops PASS.
**Key files:** `src/sites/trello/adapters/trello-api.ts` (commit 3d18e14).

## 2026-04-18 — needs_login classification + entry_url

**Context:** Verify-fix-0418 wave: `getBoards` started failing with "HTTP 400 — invalid token" after `verify --all` cycles. Probed via patchright on the persistent browser: trello.com cookies present (`dsc`, `atl_session`, anonymous trackers) but **`cloud.session.token` (Atlassian Cloud session) is MISSING**. That cookie is what the Trello REST API actually requires for auth — `dsc` alone is just a CSRF nonce. So the failure is a genuine logged-out state, not a runtime bug.
**Changes:**
- `openapi.yaml` — added `page_plan.entry_url: https://trello.com/` at the server level so the executor lands on trello.com (re-establishes whatever session is reachable) before pageFetch instead of relying on tab reuse.
- `adapters/trello-api.ts` — recognize HTTP 400 + "invalid token" as `failureClass: needs_login` with an actionable message pointing the user at the persistent browser to log in. Previously surfaced as `execution_failed` which hid the real cause.
**Verification:** Still 0/1 PASS — but now reports `needs_login` with the correct remediation. Cannot pass without a real Atlassian Cloud login in the persistent browser; not fixable from code.
**Root cause:** Trello's `cloud.session.token` (Atlassian SSO) cookie expired or was never set in this profile. Likely the persistent browser profile was rotated or the user logged out at some point during the verify sweep.
**Key files:** `src/sites/trello/openapi.yaml`, `src/sites/trello/adapters/trello-api.ts`.
