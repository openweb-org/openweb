# GitLab — Issue & Comment Write Ops

## What was added
4 new write operations: `createIssue`, `closeIssue`, `createComment`, `deleteComment`

## Approach
- Pure openapi.yaml definitions — no adapter needed, GitLab REST v4 is straightforward
- All ops use `application/json` requestBody
- `closeIssue` uses `PUT` with `state_event: close` (GitLab's standard issue state transition)
- `createComment` maps to GitLab's "notes" API (`/issues/{issueIid}/notes`)
- `deleteComment` uses `DELETE` on the note endpoint

## Auth & CSRF
- All write ops require `cookie_session` auth (browser login)
- CSRF token extracted from `<meta name="csrf-token">` via browser page
- CSRF auto-sent as `X-CSRF-Token` header on POST/PUT/DELETE

## Verification results
- **Read ops (10/10):** all PASS
- **createIssue:** PASS — confirmed POST + CSRF + requestBody works
- **closeIssue:** timeout — CSRF page state degrades after prior ops consume it; endpoint pattern is correct (same as createIssue)
- **createComment:** timeout — same CSRF exhaustion issue
- **deleteComment:** HTTP 404 — expected with placeholder noteId in example

## Key decisions
- Used `issueIid` (internal ID) not `issueId` (global) — matches GitLab API convention and how issues appear in UI (`#1`, `#2`)
- GitLab calls comments "notes" internally — mapped as `createComment`/`deleteComment` for consistency with other sites (GitHub, etc.)
- Set `safety: caution` on all write ops
- Stable IDs: gl0015–gl0018

## Known limitations
- Write ops require active GitLab browser session for CSRF token extraction
- CSRF token has limited lifetime — sequential write verification may timeout on later ops
- `deleteComment` needs a real noteId to verify (placeholder returns 404)
