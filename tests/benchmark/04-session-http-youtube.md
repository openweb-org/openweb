# Benchmark 4: Session HTTP — YouTube Video Info

## Task

Get video player info for a YouTube video. The `getVideoInfo` operation requires `page_global` auth (INNERTUBE_API_KEY) and `sapisidhash` signing.

## Mode

`session_http` — requires Chrome CDP + logged-in YouTube tab.
Uses `page_global` auth (injects API key as query param) + `sapisidhash` signing.

## Prerequisites

- Chrome running with `--remote-debugging-port=9222`
- Tab open at `https://www.youtube.com` with active login session

## Expected Tool Calls

1. `openweb youtube-fixture` — check readiness (session_http, Requires browser: yes, Requires login: yes)
2. `openweb youtube-fixture getVideoInfo` — inspect parameters
3. `openweb youtube-fixture exec getVideoInfo '{}' --cdp-endpoint http://localhost:9222` — execute

## Success Criteria

- stdout contains valid JSON response
- Response contains video player data (responseContext or similar YouTube API structure)
- No auth/signing errors

## Failure Criteria

- `failureClass: "needs_login"` — SAPISID cookie missing or page_global expression failed
- `failureClass: "needs_page"` — no YouTube tab open
- HTTP 401/403 — signing mismatch
