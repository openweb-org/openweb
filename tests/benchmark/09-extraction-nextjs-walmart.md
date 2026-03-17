# Benchmark 9: Extraction — Walmart Footer Modules

## Task

Extract Walmart homepage footer modules from Next.js `__NEXT_DATA__`.

## Mode

`session_http` readiness with an extraction-only operation (`ssr_next_data`).
Requires Chrome CDP and a matching Walmart tab, but no login.

## Prerequisites

- Chrome running with `--remote-debugging-port=9222`
- Tab open at `https://www.walmart.com/`

## Expected Tool Calls

1. `openweb walmart-fixture` — check readiness (Requires browser: yes, Requires login: no)
2. `openweb walmart-fixture getFooterModules` — inspect response shape
3. `openweb walmart-fixture exec getFooterModules '{}' --cdp-endpoint http://localhost:9222 --max-response 2048` — execute

## Success Criteria

- stdout contains a JSON array (or truncated JSON string preview of that array)
- array is non-empty
- first item is an object extracted from `__NEXT_DATA__`
- output is stable across repeated runs without requiring agent recovery

## Failure Criteria

- `failureClass: "needs_browser"` — CDP not reachable
- `failureClass: "needs_page"` — no Walmart tab open
- `failureClass: "retriable"` — `__NEXT_DATA__` missing because the page is not fully loaded
- `failureClass: "fatal"` — configured extraction path no longer matches the page payload
