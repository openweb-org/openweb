# Benchmark 6: L3 Adapter — Telegram Get Dialogs

## Task

Get the chat/dialog list from Telegram Web A using the L3 adapter (telegram-protocol).

## Mode

L3 adapter — requires Chrome CDP + logged-in Telegram Web A tab.
The adapter reads from Telegram's teact global state.

## Prerequisites

- Chrome running with `--remote-debugging-port=9222`
- Tab open at `https://web.telegram.org/a/` with active login session

## Expected Tool Calls

1. `openweb telegram-fixture` — check readiness (browser_fetch mode, Requires browser: yes, Requires login: yes)
2. `openweb telegram-fixture getDialogs` — inspect operation
3. `openweb telegram-fixture exec getDialogs '{}' --cdp-endpoint http://localhost:9222` — execute

## Success Criteria

- stdout contains JSON with dialog/chat entries
- Each entry has identifying fields (id, title/name or similar)
- Adapter init() and isAuthenticated() pass

## Failure Criteria

- `failureClass: "needs_browser"` — CDP not reachable
- `failureClass: "needs_page"` — no Telegram tab open
- `failureClass: "needs_login"` — adapter.isAuthenticated() returned false
- `failureClass: "retriable"` — adapter.init() failed (page not ready)
