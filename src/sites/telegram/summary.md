# Telegram — Write Ops Discovery & Implementation

## Final Architecture

- **Reads**: `getGlobal()` via webpack module walk — direct access to teact global state
- **Writes**: `callApi()` via webpack module walk — dispatches to GramJS Web Worker → MTProto
- **Zero DOM**: no clicks, no selectors, no navigation needed
- **13 operations total** (6 read + 7 write)

## Discovery Journey

### Phase 1: DOM Approach (failed)

Initial implementation used DOM manipulation for write ops:
- **sendMessage**: focus `#editable-message-text`, `document.execCommand('insertText')`, click send button
- **deleteMessage**: right-click message `[data-message-id]`, click `.MenuItem` "Delete", confirm dialog

**Problems hit:**
1. sendMessage failed — adapter didn't navigate to the chat first, so no input element existed
2. deleteMessage failed — `messageId: 1` from example didn't exist, and `page.goto()` for navigation broke multi-tab auth
3. Send button selector was wrong — TG shows "Record voice" button that transforms to "Send" only when text is in the input

### Phase 2: Navigation Hell

TG Web A's routing is unusual — **it only processes hash routes on initial page load**. Post-boot hash changes (`window.location.hash = '#chatId'`) are completely ignored. Tested:
- `window.location.hash` — no effect
- `page.goto()` same-origin with hash — patchright treats as no-op
- `history.pushState` + `popstate` event — ignored
- Creating and clicking `<a href="#chatId">` — ignored
- `page.goto('about:blank')` then back — worked once then auth bootstrap timed out (20s+)

**What worked for navigation**: patchright native `avatar.click()` on `[data-peer-id]` in the sidebar. `page.evaluate(() => el.click())` didn't work — only patchright's native click triggers proper mouse events that TG's teact framework responds to.

**Sidebar limitation**: chats not visible in sidebar (e.g., Saved Messages) can't be navigated to via click. Search bar fallback was implemented but unreliable.

### Phase 3: Looking for Internal API

Searched webpack modules for dispatch mechanisms:

1. **getActions()** — found via module 13439 export `ko`. On a fresh page: only **88 system-level actions** (signOut, loadConfig, blockUser etc.). No sendMessage, deleteMessages, openChat. On an authenticated page with loaded modules: **887 actions** including all message ops. But dispatching them from `page.evaluate` failed with `T[0] is not a function` — the action handlers depend on lazy-loaded sub-handlers that aren't initialized on the executor's fresh page.

2. **Searched the web** — found [Ajaxy/telegram-tt](https://github.com/Ajaxy/telegram-tt) is the open-source repo for TG Web A (GPL v3). Key discovery: TG Web A uses [GramJS](https://github.com/gram-js/gramjs) as MTProto client, running in a **Web Worker**. The main thread communicates via `callApi()` which posts `{type: "callMethod", name, args}` to the worker.

3. **Found connector.ts architecture** by reading the GitHub source:
   - `callApi(methodName, ...args)` → `makeRequest()` → `worker.postMessage()` → GramJS worker → MTProto → Telegram servers
   - Master/slave tab routing via `BroadcastChannel`
   - Response via `handleMethodResponse()` resolving stored promises by `messageId`

### Phase 4: Finding callApi in Webpack

Probed the live page for the connector module:
- Scanned module source strings for `"callMethod"` + `"cancelApiProgress"` (unique to connector.ts)
- Found module **4875** with 10 exports
- Identified export `px` (function N) as `callApi` by matching source pattern: contains `"callMethod"` and `"name:"`
- Also found module **5130** with `requestStates`, `pendingPayloads`, `postMessageOnTickEnd` — the ConnectorClass

**Tested**: `callApi('fetchCurrentUser')` — returned successfully. Confirmed 430+ callApi methods available by scanning all modules for `.px)("methodName"` pattern.

### Phase 5: callApi for Writes

**sendMessage via callApi** — worked immediately:
```
callApi('sendMessage', { chat: global.chats.byId[chatId], text: 'hello' })
```
The chat object from `getGlobal()` has all needed fields including `accessHash`.

**deleteMessages via callApi** — initially hung (promise never resolved):
- Tested with 8s, 15s, 20s timeouts — always timed out
- The chat object had `accessHash` and was valid
- Checked TG source: `deleteMessages` calls `invokeRequest()` which should always resolve
- **Root cause**: the message ID didn't exist in the worker's entity cache. When using `messageId: "latest"` resolved from a fresh page's `getGlobal()`, the ID was from a message sent on a *previous* page whose state hadn't synced to the new page. Using a known-existing message ID → **worked instantly**.

**Lesson**: callApi operates on the worker's entity cache, not the main thread's state. If the worker hasn't "seen" an entity (message, chat), callApi may hang. The message must exist in the worker's knowledge.

### Phase 6: Considered but Rejected

1. **Adding GramJS as npm dependency** — would enable pure Node.js API calls without browser. Rejected: adds large dependency, needs api_id/api_hash management, session extraction complexity. The in-page `callApi` is zero-dependency and uses the existing auth.

2. **teact action dispatch** (`getActions().sendMessage(...)`) — would be cleanest but action handlers aren't fully initialized on fresh executor pages. Only works on pages that have already loaded all lazy modules (e.g., pages kept open from previous operations).

3. **Extracting GramJS StringSession** for Node.js reuse — technically possible but risks "Many logins" conflicts and session management complexity.

## Key Patterns Discovered

- **webpack_module_walk**: finds `getGlobal` by return shape (`{chats, users}`), finds `callApi` by source strings (`callMethod`, `cancelApiProgress`)
- **TG Web A ignores post-boot hash changes** — only processes `#chatId` on initial page load
- **Multi-tab architecture**: TG uses master/slave tabs. Opening a second tab causes auth issues. The managed browser must be the only TG tab.
- **430 callApi methods** available in the GramJS connector — trivial to add more ops
- **887 teact actions** on fully-loaded pages — potential alternative path if lazy-loading is solved
- **chatId resolution**: `"me"` → currentUserId, `"+phone"` → user lookup, raw numeric IDs passthrough
- **verify command browser flakiness**: `ensureBrowser()` without cdpEndpoint intermittently returns stale browser handles. `exec` works reliably because it calls `ensureBrowser(cdpEndpoint)` per-operation.
