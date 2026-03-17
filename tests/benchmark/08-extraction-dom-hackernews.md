# Benchmark 8: Extraction — Hacker News Top Stories

## Task

Read the current Hacker News front page by extracting DOM content from the open page.

## Mode

`session_http` readiness with an extraction-only operation (`html_selector`).
Requires Chrome CDP and a matching Hacker News tab, but no login.

## Prerequisites

- Chrome running with `--remote-debugging-port=9222`
- Tab open at `https://news.ycombinator.com/news`

## Expected Tool Calls

1. `openweb hackernews-fixture` — check readiness (Requires browser: yes, Requires login: no)
2. `openweb hackernews-fixture getTopStories` — inspect response shape
3. `openweb hackernews-fixture exec getTopStories '{}' --cdp-endpoint http://localhost:9222 --max-response 2048` — execute

## Success Criteria

- stdout contains a JSON array (or truncated JSON string preview of that array)
- array is non-empty
- first item contains a non-empty `title`
- items include `score` and `author` fields, which may be `null`

## Failure Criteria

- `failureClass: "needs_browser"` — CDP not reachable
- `failureClass: "needs_page"` — no Hacker News tab open
- `failureClass: "retriable"` — selectors no longer match or the page has not finished loading
