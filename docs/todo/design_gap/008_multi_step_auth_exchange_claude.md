# Design Gap: Multi-Step Auth Token Exchange Workflows

## Severity: HIGH

## Problem

Many enterprise platforms use multi-step authentication where a primary credential
(session cookie, MSAL token) must be exchanged for a secondary token via an
intermediate API call. The secondary token is short-lived and must be refreshed
periodically. HAR captures one point-in-time snapshot of these tokens, which are
expired by replay time.

## Affected Sites

**Microsoft Teams:**
1. Find MSAL token in localStorage (pattern-match keys)
2. Call `teams.live.com/api/auth/v1.0/authz/consumer` with MSAL token
3. Receive Skype JWT (expires in ~1 hour)
4. Cache JWT, refresh 60s before expiration
5. Use JWT for all subsequent API calls

**Reddit:**
1. Session cookies are HttpOnly (not readable by JS)
2. Call `/api/me.json` to extract `modhash` (CSRF token)
3. Call `/svc/shreddit/token` with `csrf_token` cookie
4. Receive short-lived bearer token for `oauth.reddit.com`
5. Use bearer token for all API calls

**AWS Console:**
1. STS credentials extracted from iframe via `Response.prototype.json` patching
2. Credentials expire every ~15 minutes
3. Must monitor for credential refresh events via MutationObserver
4. Use credentials for SigV4 signing

**ChatGPT:**
1. Lazy auth: token not fetched until first API call
2. Call `/api/auth/session` to get access token
3. Token may be rate-limited on repeated calls
4. Use bearer token for `backend-api` calls

## Why OpenWeb Can't Handle It

1. HAR captures the token exchange as separate HTTP requests, but doesn't encode
   the dependency chain (step N depends on step N-1)
2. Tokens captured in HAR are expired by replay time
3. Refresh logic (timing, error-triggered) is in plugin code, not HTTP data
4. Token exchange endpoints may have rate limits that prevent repeated calls
5. OpenWeb's spec format (OpenAPI 3.1) has no way to express "call endpoint A
   first, extract field X from response, use it as header for endpoint B"

## Potential Mitigations

- **Auth flow specification**: Extend the spec format to support auth dependency
  chains: "to call endpoint B, first obtain token from endpoint A"
- **Token refresh in runtime**: Implement token refresh logic in the executor
  (detect 401, re-run auth exchange, retry)
- **Pre-flight auth step**: Before replaying any tool, run the auth exchange
  sequence to obtain fresh tokens
- **Browser session mode**: For complex auth flows, maintain a live browser
  session that handles token exchange natively
