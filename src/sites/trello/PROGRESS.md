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
