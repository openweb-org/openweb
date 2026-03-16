# Benchmark 2: Session HTTP — Instagram Timeline

## Task

Fetch the authenticated user's Instagram feed timeline.

## Mode

`session_http` — requires Chrome CDP + logged-in Instagram tab.

## Prerequisites

- Chrome running with `--remote-debugging-port=9222`
- Tab open at `https://www.instagram.com` with active login session

## Expected Tool Calls

1. `openweb instagram-fixture` — check readiness (Requires browser: yes, Requires login: yes)
2. `openweb instagram-fixture getTimeline` — inspect parameters
3. `openweb instagram-fixture exec getTimeline '{}' --cdp-endpoint http://localhost:9222` — execute

## Success Criteria

- stdout contains JSON with `items` array (feed posts)
- `items` is a non-empty array
- `more_available` boolean present
- Response includes `next_max_id` if more pages exist

## Failure Criteria

- `failureClass: "needs_browser"` — Chrome not running or CDP not reachable
- `failureClass: "needs_page"` — no Instagram tab open
- `failureClass: "needs_login"` — cookies expired or logged out
- HTTP 401/403 — auth pipeline failed
