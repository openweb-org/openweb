# Design Gap: Cross-Origin Bearer Token APIs with CORS Constraints

## Severity: MEDIUM-HIGH

## Problem

Many sites make API calls to domains different from the page origin. These
cross-origin requests require bearer tokens (not cookies) and must comply with CORS.
Token extraction requires reading from the primary domain's browser state, then
making requests to a secondary domain with `credentials: 'omit'`.

OpenWeb's HAR captures these cross-origin requests, but replaying them requires:
1. Knowing which domain holds the token
2. Extracting the token from browser storage (gap #002)
3. Making requests with the correct CORS-compliant headers

## Affected Sites

- **Costco** — Calls `ecom-api.costco.com`, `geocodeservice.costco.com`,
  `api.digital.costco.com` from `www.costco.com`. Bearer token extracted from
  sessionStorage keyed by `hashedUserId` cookie.
- **Azure** — ARM API at `management.azure.com` (cross-origin from
  `portal.azure.com`). MSAL bearer token from sessionStorage.
- **Bluesky** — XRPC calls to user's PDS server (different origin). JWT from
  localStorage `BSKY_STORAGE`.
- **Robinhood** — Multiple API domains: `api.robinhood.com`,
  `bonfire.robinhood.com`, `nummus.robinhood.com`, `dora.robinhood.com`. Same
  bearer token across all domains.
- **ClickHouse** — ARM API cross-origin calls with Auth0 bearer token.

## Why OpenWeb Can't Handle It

1. HAR captures cross-origin requests but token source is opaque (stored in
   browser state, not HTTP)
2. Cross-origin replay from Node.js (`direct_http`) has no CORS restriction,
   but also has no token without browser state access
3. Token extraction logic is domain-coupling-specific (Costco: cookie value →
   sessionStorage key → bearer token)
4. Multiple API domains per site require routing logic not captured in HAR
5. Some cross-origin APIs validate `Origin` or `Referer` headers — replaying
   from a different origin fails

## Potential Mitigations

- **Multi-domain spec**: Support multiple base URLs per site spec, with shared
  auth configuration
- **Token source annotation**: Annotate which storage mechanism provides the
  bearer token for each domain
- **Origin header injection**: In `direct_http` mode, inject the correct `Origin`
  and `Referer` headers to satisfy CORS validation
- **Domain discovery in recorder**: During Phase 1, track which domains received
  requests and group them into the same site spec
