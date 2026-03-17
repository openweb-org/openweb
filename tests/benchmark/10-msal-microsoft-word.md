# Benchmark 10: MSAL Auth — Microsoft Word Profile

## Task

Read the signed-in Microsoft Word user's profile by reusing Word's MSAL token cache for a Microsoft Graph request.

## Mode

`session_http` with `sessionStorage_msal` auth.
Requires Chrome CDP, a matching Word tab, and an active Microsoft login.

## Prerequisites

- Chrome running with `--remote-debugging-port=9222`
- Tab open at `https://word.cloud.microsoft/`
- Active Microsoft account session in Word

## Expected Tool Calls

1. `openweb microsoft-word-fixture` — check readiness (Requires browser: yes, Requires login: yes)
2. `openweb microsoft-word-fixture getProfile` — inspect response shape
3. `openweb microsoft-word-fixture exec getProfile '{}' --cdp-endpoint http://localhost:9222` — execute

## Success Criteria

- stdout contains JSON with `id`, `displayName`, and `userPrincipalName`
- request succeeds without the agent manually extracting or pasting a bearer token
- repeated execution succeeds while the MSAL token remains valid

## Failure Criteria

- `failureClass: "needs_browser"` — CDP not reachable
- `failureClass: "needs_page"` — no Word tab open
- `failureClass: "needs_login"` — MSAL cache missing, expired, or user logged out
