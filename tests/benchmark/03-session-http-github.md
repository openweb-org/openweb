# Benchmark 3: Session HTTP — GitHub List Issues with Pagination

## Task

List issues from a public repository (e.g., `facebook/react`) with pagination, fetching the first page of 5 issues.

## Mode

`session_http` — requires Chrome CDP + logged-in GitHub tab.
Uses `meta_tag` CSRF + `link_header` pagination.

## Prerequisites

- Chrome running with `--remote-debugging-port=9222`
- Tab open at `https://github.com` with active login session

## Expected Tool Calls

1. `openweb github` — check readiness (session_http, Requires browser: yes)
2. `openweb github listIssues` — inspect parameters (owner, repo, page, per_page)
3. `openweb github exec listIssues '{"owner": "facebook", "repo": "react", "per_page": 5}' --cdp-endpoint http://localhost:9222` — execute

## Success Criteria

- stdout contains JSON array of issue objects
- Each issue has `title`, `number`, `state` fields
- Array length <= 5 (per_page respected)
- Agent correctly supplies path parameters (owner, repo)

## Failure Criteria

- `failureClass: "fatal"` with INVALID_PARAMS — missing owner/repo path params
- `failureClass: "needs_browser"` — CDP not reachable
- HTTP 404 — wrong owner/repo values
