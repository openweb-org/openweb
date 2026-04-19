## 2026-04-18 — Write-Verify: SPA-readiness restore + Worker entity priming

**Context:** Post-`32a698a` (CustomRunner migration), all 5 write ops failed in `verify --write`. The migration commit had stripped `init()` claiming it was a "trivial webpack-ready check" — wrong. `init()` was load-bearing: it polled `webpackChunktelegram_t` chunk registration AND `getGlobal()?.currentUserId` to gate `run()` on full SPA hydration. Without it, `findGetGlobal`/`findCallApi` walked an empty webpack registry and silently returned undefined.
**Changes:**
- Commit `cedf7db`: restored the SPA-readiness gate at the top of `run()` as `page.waitForFunction` polling for `(webpackChunktelegram_t || webpackChunkwebk).length > 0` AND `getGlobal()?.currentUserId !== undefined`. Adapter is now resilient to fast-restart races and fresh-profile boots.
- Commit `defc044`: dispatched `actions.openChat({ id: getGlobal().currentUserId })` on every `run()` to prime the GramJS Worker's entity cache for Saved Messages. Without this, callApi mutations targeting `chatId: "me"` race against an empty Worker cache.
- Server URL switched from bare `web.telegram.org` to `web.telegram.org/a/` (the Web A path the adapter targets).
**Verification:** 1/5 PASS — `markAsRead`. The other 4 (`editMessage`, `forwardMessages`, `pinMessage`, `unpinMessage`) fail with "no outgoing messages" because the test account's Saved Messages chat has no outgoing message for `messageId: "latest"` to resolve to. **User action:** send any text to Saved Messages once, then re-verify.
**Key discovery:** A `CustomRunner` migration that drops `init()` for an SPA-style site is almost always wrong. Even a "trivial" precheck may be the only thing waiting for hydration. The general lesson is captured in `skill/openweb/knowledge/extraction.md` § SPA Hydration Gate.
**Pitfalls:** The migration tested as 5/5 PASS at the time because verify did not exercise write ops by default until the `--write` campaign. CustomRunner migrations should be re-verified with `--write` before landing.

## 2026-04-17 — Adapter Refactor

**Context:** Phase 5C normalize-adapter sweep — migrate site adapters off the legacy `CodeAdapter` interface (`init` / `isAuthenticated` / `execute`) onto the simpler `CustomRunner` shape (`run(ctx)`).
**Changes:**
- `adapters/telegram-protocol.ts`: `CodeAdapter` → `CustomRunner`; 459 → 425 lines.
- Dropped trivial `init()` webpack-ready check; preserved the "Many logins" conflict detection inline in `run()` preamble — throws `helpers.errors.fatal(...)` with an explicit message instead of failing silently downstream.
- Dropped `isAuthenticated()` (only inspected `getGlobal()?.currentUserId` from local state with no server probe; ops needing `currentUserId` already throw "Not authenticated" inline).
- Migrated param-validation throws from `makeError('...', 'fatal')` to `helpers.errors.missingParam(name)` for uniform classification.
**Verification:** 5/5 ops PASS.
**Key files:** `src/sites/telegram/adapters/telegram-protocol.ts`
**Commit:** 32a698a

## 2026-04-10: v3.0 — callApi writes + 6 new operations (13 total)

**What changed:**
- Rewrote all write ops from DOM manipulation to `callApi()` (GramJS Web Worker)
- sendMessage: DOM keyboard → `callApi('sendMessage', {chat, text})`
- deleteMessage: DOM right-click context menu → `callApi('deleteMessages', {chat, messageIds})`
- Added 6 new operations: getContacts, editMessage, forwardMessages, pinMessage, unpinMessage, markAsRead
- Extracted shared `resolveCtx()` helper for chatId resolution (me, +phone, raw ID)
- Added `findCallApi()` webpack scanner — locates callApi by "callMethod"+"cancelApiProgress" string constants
- deleteMessage now supports `messageId: "latest"` (resolves to most recent outgoing from state)

**Why:**
- DOM-based writes were fragile (depended on CSS selectors, context menus, confirm dialogs)
- callApi goes directly to GramJS Worker → MTProto, completely bypassing the DOM
- Architecture: reads via getGlobal (webpack state), writes via callApi (GramJS Worker)

**Verification:** 7/7 ops PASS in `verify --write --browser`, new ops exec-tested individually
**Commit:** pending

## 2026-04-10: v2.1 — fixed sendMessage + deleteMessage DOM approach

**What changed:**
- sendMessage: added chat navigation (sidebar click + search fallback)
- deleteMessage: fixed DOM selectors, added modal dismissal, chat navigation
- Discovered TG Web A ignores post-boot hash changes — sidebar click is the only reliable navigation
- Fixed chatId resolution to not treat numeric IDs as phone numbers

**Why:**
- Both write ops failed in verify — sendMessage didn't navigate to chat, deleteMessage used stale selectors

**Verification:** 6/7 PASS (getChats DRIFT on membersCount)

## 2026-04-01: v2.0 — expanded to 7 operations

**What changed:**
- Expanded from 3 to 7 operations: getChats, getMessages, searchMessages, getUserInfo, getMe, sendMessage, deleteMessage
- Renamed getDialogs → getChats for consistency
- Added richer response fields: senderName, isOutgoing, membersCount, lastMessageDate

**Why:**
- Prior package only had basic read operations; messaging archetype expects search, contacts, and write operations

**Verification:** adapter-level (requires logged-in browser session)
