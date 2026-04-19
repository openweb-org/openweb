# WhatsApp Web — Progress

## 2026-04-01: Full rediscovery (adapter-only)

**What changed:**
- Standard capture attempted: 2 requests, 0 WS, 0 usable API samples (encrypted binary WS)
- Confirmed adapter-only path: Metro-style `require('WAWeb*')` module system
- 7 operations: getChats, getMessages, getContacts, searchChats, getChatById, sendMessage, markAsRead
- All operations use page transport + adapter (no HTTP API exists)

**Why:**
- Rediscovery from scratch — prior package deleted from worktree
- WhatsApp Web uses Signal Protocol encrypted binary WebSocket, no REST/GraphQL

**Verification:** adapter probe confirmed module system accessible, collections available

## 2026-04-17 — Adapter Refactor

**Context:** Phase 5C adapter normalization — migrate from legacy `CodeAdapter` (separate `init`/`isAuthenticated`/`run` hooks) to unified `CustomRunner` shape with single `run(ctx)` entry point.
**Changes:** `src/sites/whatsapp/adapters/whatsapp-modules.ts` rewritten (257 → 279 lines, +22). Both `init()` (Metro module-ready probe) and `isAuthenticated()` (chat collection populated probe) folded inline into a single `ensureReady` preamble at the top of `run()`. WhatsApp preserved both hooks (unusual) because each is a real dynamic-state probe — the Metro `require('WAWebChatCollection')` check is beyond PagePlan's CSS-selector readiness, and the `ChatCollection.length > 0` check is server-derived auth validity rather than credential presence. `ensureReady` throws `errors.retriable` (modules not loaded) or `errors.needsLogin()` (empty collection).
**Verification:** 3/3 ops PASS (commit d2dbba9).
**Key discovery:** Per-run cost trade-off — `ensureReady` now runs on every `run()` call instead of once at init. Cost is two short `page.evaluate` calls (cheap), and the change eliminates a race where ops dispatched before the Metro module system finished loading.
**Key files:** `src/sites/whatsapp/adapters/whatsapp-modules.ts`

## 2026-04-18 — Write-op verify fix
**Context:** `markAsRead` was defined in `openapi.yaml` and has a read→write workflow in SKILL.md, but the cc14753 write-ops commit shipped only the `deleteMessage` example fixture — `markAsRead` had none. Verify silently skipped it ("0/0 ops" because the `--ops markAsRead` filter found no matching example file → empty operations array → site-level FAIL). Same root cause as costco: missing fixture, not a runtime/adapter bug.
**Changes:** Added `examples/markAsRead.example.json` with `read: true` (idempotent toggle — safe to replay against an already-read chat). Adapter and openapi unchanged. (commit 0a05cf8)
**Verification:** 1/1 PASS — `pnpm dev verify whatsapp --write --browser --ops markAsRead`.
**Key discovery:** When seeding a new write op into a site, the example fixture is part of the deliverable — without it, `verify --write` reports green but never actually exercises the op.
