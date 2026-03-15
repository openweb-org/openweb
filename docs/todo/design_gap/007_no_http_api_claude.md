# Design Gap: Applications with No HTTP API (Client-Side Module Invocation)

## Severity: CRITICAL

## Problem

Some major applications have NO HTTP API for core functionality. All operations are
performed through internal JavaScript modules, Web Workers, or direct DOM
manipulation. These sites are completely invisible to HAR recording.

## Affected Sites

**WhatsApp Web:**
- Uses internal `require()` module system to access `WAWebChatCollection`,
  `WAWebContactCollection`, `WAWebSetArchiveChatAction`, etc.
- Sending messages requires DOM manipulation: find Lexical editor compose box,
  dispatch keyboard/paste events, press Enter
- All communication goes through encrypted WebSocket (Signal Protocol)
- Zero HTTP API endpoints for messaging

**Telegram Web:**
- Uses `rootScope.managers.apiManager.invokeApi()` — a proxy to a Web Worker
  running MTProto protocol
- Peer resolution, message sending, contact management all through this proxy
- The MTProto layer serializes to binary, not HTTP JSON

## Why OpenWeb Can't Handle It

1. No HTTP traffic to capture in HAR — the compiler pipeline has zero input
2. Operations are JavaScript function calls on live objects, not HTTP requests
3. These internal APIs are undocumented and change with each deployment
4. Binary protocols (MTProto, Signal) cannot be replayed via HTTP
5. DOM manipulation (WhatsApp message sending) has no HTTP equivalent
6. OpenWeb's entire architecture assumes HTTP as the transport layer

## Potential Mitigations

- **Accept as out of scope**: These sites fundamentally cannot be "compiled" into
  HTTP API specs. Document the limitation explicitly.
- **Browser automation fallback**: For these sites, fall back to Playwright-style
  browser automation (click, type, wait) rather than API replay
- **Hybrid approach**: Generate a spec that marks certain operations as
  "browser-only" and delegates to a browser automation runtime
- **Module introspection**: If the runtime must support these sites, extract and
  sandbox internal modules — but this is extremely fragile and version-dependent
