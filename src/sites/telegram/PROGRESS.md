## 2026-04-20 — deleteMessage fixture chained in Saved Messages (handoff5)

**Context:** `deleteMessage` was the last unchained write op — fixture pinned `chatId: "8259810574"` (a real peer) with `messageId: "latest"`, which is fragile (peer can leave/archive) and risked deleting cross-account history. `sendMessage` had no `order:` field, so the resolver could see no outgoing messages and the op silently no-op'd or hit "no outgoing messages".
**Changes:** `sendMessage.example.json` gained `"order": 1` to seed Saved Messages first; `deleteMessage.example.json` switched `chatId` to `"me"` (resolved to `currentUserId` per `adapters/telegram-protocol.js:110`) and `"order": 7` so it runs after the existing `editMessage`/`forwardMessages`/`pinMessage`/`unpinMessage`/`markAsRead` chain. Fallback: junk account `@vdyzrisw` if Saved Messages ever gets restricted. (commit 1982640)
**Verification:** `pnpm dev verify telegram --browser --write` 12/12 PASS.
**Key discovery:** Saved Messages (`chatId: "me"`) is the canonical hermetic-fixture target for telegram writes — no shared-state pollution, no peer dependency, no risk of corrupting real chats. Combine with `messageId: "latest"` + an `order: 1` seed to make the chain self-creating.

## 2026-04-19 — Write-Verify Campaign: 4/5 PASS via outgoing-message fixture + forwardMessages adapter fix

**Context:** Prior session left telegram at 1/5 (markAsRead only). The other 4 write ops (`editMessage`, `forwardMessages`, `pinMessage`, `unpinMessage`) all failed with "no outgoing messages" because they resolve `messageId: "latest"` against `global.messages.byChatId[peerId]` filtered by `isOutgoing === true`, and the verify account's Saved Messages chat had never had an outgoing message.
**Changes:**
- Fixture-side: ran `pnpm dev telegram exec sendMessage '{"chatId":"me","text":"openweb-verify-test"}'` once to seed Saved Messages with an outgoing message. This single fixture-setup step unblocked `editMessage`, `pinMessage`, `unpinMessage` (verified PASS).
- `adapters/telegram-protocol.ts` `forwardMessages`: was passing `messages: messageIds.map(id => ({ id, chatId: peerId }))` — stub objects. `callApi('forwardMessages', ...)` requires real `ApiMessage` entities. Rewrote to look each id up in `global.messages.byChatId[peerId].byId` and pass the loaded entities; refuse if any are missing.
- Same op: added self-chat synthesis fallback for `toChat` when `toChatId === "me"`, mirroring `resolveCtx`'s existing fallback for `fromChat`. Without it, a fresh-session forward to Saved Messages throws `Chat me not found in state` because `chats.byId[currentUserId]` may be empty until the user opens that chat.
**Verification:** 4/5 PASS (`markAsRead`, `editMessage`, `pinMessage`, `unpinMessage`). `forwardMessages` adapter fix landed but live-verify was blocked: the openweb browser lifecycle restarted Chrome multiple times during retest, the source profile snapshot got wiped, and CDP repeatedly missed the logged-in tab. The fix is small, isolated, and theoretically correct; it ships unverified for a future session retest.
**Key discovery:** Telegram Web's `callApi('forwardMessages', ...)` is strict about the `messages` argument — it must be the actual hydrated `ApiMessage` from the global store, not a stub. The error surfaces as a bare `page.evaluate: Object` because the GramJS Worker rejects with a non-Error value. Whenever a write op only needs an id but the underlying API takes an entity, the adapter must hydrate via the global store before dispatch.
**Pitfalls:**
- The "send one outgoing message" prerequisite is account-shaped, not site-shaped. It's now documented in `DOC.md` § Known Issues and `SKILL.md` § Saved Messages write-verify prerequisite, so future verify campaigns on a fresh account won't re-rediscover it.
- Repeatedly retrying `verify --browser` after a CDP failure can spawn parallel Chrome instances that clobber each other's profile copies. The lifecycle treats a stale `browser.pid` as "external Chrome on port" and refuses to attach. Pause and confirm browser state with the user before retry-loops, per the global "pause before browser CDP" feedback.

---


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
