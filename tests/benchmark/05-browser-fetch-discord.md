# Benchmark 5: Browser Fetch — Discord Get Current User

## Task

Get the current authenticated Discord user's profile using browser_fetch mode with webpack_module_walk auth.

## Mode

`browser_fetch` — requires Chrome CDP + logged-in Discord tab.
Uses `webpack_module_walk` auth to extract token from Discord's webpack bundles.

## Prerequisites

- Chrome running with `--remote-debugging-port=9222`
- Tab open at `https://discord.com/channels/@me` with active login session

## Expected Tool Calls

1. `openweb discord-fixture` — check readiness (browser_fetch, Requires browser: yes, Requires login: yes)
2. `openweb discord-fixture getMe` — inspect operation (no params needed)
3. `openweb discord-fixture exec getMe '{}' --cdp-endpoint http://localhost:9222` — execute

## Success Criteria

- stdout contains JSON with `id`, `username` fields
- `id` is a string (Discord snowflake)
- `username` is a non-empty string
- fetch executed inside browser context (credentials: include)

## Failure Criteria

- `failureClass: "needs_browser"` — CDP not reachable
- `failureClass: "needs_page"` — no Discord tab open
- `failureClass: "needs_login"` — webpack_module_walk failed to extract token
- HTTP 401 — token expired (page refresh may fix)
