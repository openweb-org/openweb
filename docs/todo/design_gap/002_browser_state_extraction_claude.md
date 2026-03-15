# Design Gap: Browser State Extraction (localStorage, sessionStorage, window globals)

## Severity: CRITICAL

## Problem

Modern SPAs store critical auth tokens, user context, and configuration in browser
storage (localStorage, sessionStorage) and window globals — not in HTTP
request/response headers. OpenWeb's HAR recording only captures HTTP traffic, making
this state invisible to the compiler.

This is the single most pervasive gap. Nearly every authenticated SPA plugin in
OpenTabs extracts some form of browser state.

## Affected Sites (30+)

**localStorage auth tokens:**
- Linear — `ApplicationStore` JSON with `currentUserAccountId`
- ClickUp — `cuHandshake` JSON with workspace config + `apiUrlBase`
- Panda Express — `persist:root` nested JSON with `appState.authentication.authtoken`
- Robinhood — `web:auth_state` with `access_token`
- Bluesky — `BSKY_STORAGE` with `accessJwt`

**localStorage OAuth/MSAL tokens:**
- OneNote, PowerPoint, Excel Online — MSAL token cache with pattern-matching keys
  (`msal.token.keys.*` + `graph.microsoft.com` scope filtering)
- ClickHouse — Auth0 SPA SDK token under `@@auth0spajs@@::*` keys
- Priceline — `okta-token-storage` with JWT + custom claims

**sessionStorage:**
- Costco — `authToken_${hashedUserId}` (key depends on cookie value)
- Azure — MSAL tokens with scope-based matching

**Window globals:**
- Netflix — `window.netflix.reactContext.models.memberContext`
- New Relic — `window.__nr.userId`
- npm — `window.__context__.context.user.name` + `csrftoken`
- PostHog — `window.POSTHOG_APP_CONTEXT.current_team.id`
- Sentry — `window.__initialData.isAuthenticated`
- YouTube — `ytcfg.data_` with `INNERTUBE_API_KEY`, `SESSION_INDEX`
- Slack — Multiple fallback paths: `localStorage`, `window.TS.boot_data`,
  regex from script tags

## Why OpenWeb Can't Handle It

1. HAR only records HTTP request/response pairs
2. localStorage/sessionStorage writes happen via JavaScript execution, not HTTP
3. Window globals are populated by SSR hydration or client-side JS bootstrap
4. Token formats are site-specific (nested JSON, JWT, Auth0 wrapper objects, MSAL
   cache structure with expiration checks)
5. OpenWeb's `direct_http` and `session_http` modes have no access to browser storage
6. Even `browser_fetch` mode would need to know which storage keys to read

## Potential Mitigations

- **Browser context snapshot**: During recording, capture localStorage/sessionStorage
  state alongside HAR (Playwright can do this via `page.evaluate()`)
- **Token extraction annotations**: In the generated spec, annotate which storage
  keys contain auth tokens and how to extract them
- **Runtime browser mode**: For sites that require browser state, always use
  `browser_fetch` mode and inject extraction logic into the page
- **Auth store abstraction**: Define a standard auth extraction interface in the
  spec (similar to OpenTabs' `getAuthCache`/`setAuthCache` pattern)
