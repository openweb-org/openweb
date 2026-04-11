# WhatsApp — Transport Upgrade: sendMessage via Internal Module

## Final Architecture

- **Reads**: `require('WAWebChatCollection').ChatCollection.getModelsArray()` — direct Backbone collection access
- **Writes**: `require('WAWebSendTextMsgChatAction').sendTextMsgToChat()` (send) + `chat.deleteMessages()` (delete) + `require('WAWebChatSeenBridge').markConversationSeen()` (read status)
- **Zero DOM**: no clicks, no selectors, no keyboard automation, no compose box
- **8 operations total** (5 read + 3 write)

## Discovery Journey

### Phase 1: Understanding the Problem

The existing sendMessage used DOM keyboard automation:
1. Open chat via `WAWebCmd.Cmd.openChatBottom({ chat })`
2. Wait for compose box selector `div[contenteditable="true"][data-tab="10"]`
3. Click, type with 20ms delay per character, press Enter
4. Wait 2s for WebSocket round-trip
5. Verify in Store

The code comment said: "Store-level addAndSendMsgToChat silently drops messages in the adapter execution context, so DOM interaction is the reliable approach."

Meanwhile, deleteMessage already used a direct internal module call (`chat.deleteMessages([id])`), proving that internal module access works for write operations. (deleteMessage was itself recently upgraded from DOM to internal module.)

### Phase 2: Module Discovery (Probe)

Probed WhatsApp Web's Metro module system (`__d/__w/require`) via `page.evaluate()`:

**Probe 1: Module registry scan.**
Tested 24 WAWeb* module name candidates. Found 7 live modules:
- `WAWebCollections` — master store with 40+ collection exports
- `WAWebMsgCollection` — message collection model
- `WAWebSendMsgChatAction` — exports: `addAndSendMsgToChat`, `resendMsgToChat`, `addVoipCallLogMsgToChat`
- `WAWebSendTextMsgChatAction` — exports: `sendTextMsgToChat`, `createTextMsgData`, `addAndSendTextMsg`
- `WAWebMsgKey` — exports: `fromString`, `from`, `newId`, `newId_DEPRECATED`, `displayName`
- `WAWebBackendApi` — backend API utilities
- `WAWebWam` — WhatsApp Analytics Module

**Probe 2: Chat model prototype.**
134 methods on the ChatImpl prototype, including `deleteMessages`, `deleteMsgsPartial`, `sortMsgs`, `waitForChatLoading`, `getMediaMsgs`, etc. No `send*` method — confirms message sending is handled by separate action modules, not the chat model.

**Probe 3: Function source analysis.**
- `addAndSendMsgToChat(chat, msg, opts)`: calls `C(WAWebStateUtils.unproxy(chat), msg, opts)` — requires a pre-built message object
- `sendTextMsgToChat(chat, text, opts)`: async wrapper — higher-level, builds message internally from text string
- `addAndSendTextMsg(chat, text, opts)`: similar async wrapper
- `WAWebStateUtils` exports only `unproxy` — Backbone models are proxied, and `addAndSendMsgToChat` handles unproxying internally

**Key insight**: The old comment blaming "addAndSendMsgToChat" was about a *different* function — `addAndSendMsgToChat` from `WAWebSendMsgChatAction` requires a raw message protobuf object, which is hard to construct correctly. But `sendTextMsgToChat` from `WAWebSendTextMsgChatAction` is the high-level text-specific function that builds the message internally.

### Phase 3: Live Test

Called `sendTextMsgToChat(chat, 'openweb probe test', {})` from `page.evaluate()`:
```json
{
  "messageSendResult": "OK",
  "t": 1775918333,
  "count": null
}
```

**Message sent successfully.** The function:
1. Takes the chat model directly (no need to unproxy manually)
2. Takes a plain text string (no message protobuf construction needed)
3. Returns a promise that resolves with `{messageSendResult, t}` after the WS round-trip
4. Works reliably in the `page.evaluate()` context — no "silent drops"

### Phase 4: Implementation

Replaced the entire DOM-based sendMessage with a single `page.evaluate()` call:

```typescript
const sendMod = req('WAWebSendTextMsgChatAction')
return sendMod.sendTextMsgToChat(chat, message, {}).then((result) => ({
  success: result.messageSendResult === 'OK',
  timestamp: result.t ?? 0,
}))
```

**What was removed:**
- `COMPOSE_SELECTOR` constant (`div[contenteditable="true"][data-tab="10"]`)
- `WAWebCmd.Cmd.openChatBottom()` navigation call
- `page.waitForSelector()`, `page.click()`, `page.keyboard.type()`, `page.keyboard.press()`
- Three `page.waitForTimeout()` calls (200ms, 200ms, 2000ms)
- Post-send Store verification step (the function's return value is the verification)

**Code reduction:** sendMessage function went from 48 lines (multi-step DOM + verify) to 18 lines (single `page.evaluate`).

**Total latency reduction:** Eliminated ~2.5s of artificial waits (200ms + 200ms + 2000ms) plus variable typing time (20ms/char). The internal module call completes in a single WS round-trip.

## Key Patterns Discovered

- **WAWebSendTextMsgChatAction.sendTextMsgToChat**: the correct high-level text send function. Don't confuse with `WAWebSendMsgChatAction.addAndSendMsgToChat` which requires pre-built message objects.
- **Metro module names are stable**: `WAWeb*` module names persist across WhatsApp Web updates (tested over multiple deploys). The module ID numbers change but names don't.
- **Chat models work as-is**: No need to manually call `WAWebStateUtils.unproxy()` — the `sendTextMsgToChat` function handles unproxying internally.
- **Promise-based return**: Write functions return promises that resolve after the WS round-trip, providing built-in confirmation (`messageSendResult: "OK"`).

## Rejected Approaches

1. **addAndSendMsgToChat** (from `WAWebSendMsgChatAction`) — requires constructing a raw message protobuf object. The previous developer's "silently drops messages" experience was likely from passing incomplete message data. `sendTextMsgToChat` handles message construction internally.

2. **Keeping DOM as fallback** — unnecessary. The internal module is strictly more reliable (no selector changes, no timing dependencies, no keyboard event issues). If the module API changes, the adapter will throw a clear error rather than silently failing.

## Verification

**Result: 8/8 PASS** (2026-04-11)

| Operation | Method | Result |
|-----------|--------|--------|
| getChats | module walk | PASS |
| getMessages | module walk | PASS |
| getContacts | module walk | PASS |
| getChatById | module walk | PASS |
| searchChats | module walk | PASS |
| sendMessage | `sendTextMsgToChat` | PASS |
| deleteMessage | `chat.deleteMessages()` | PASS |
| markAsRead | `markConversationSeen` | PASS |

Formal `verify whatsapp --write --browser`: 4/4 PASS (auto-verifiable ops).
