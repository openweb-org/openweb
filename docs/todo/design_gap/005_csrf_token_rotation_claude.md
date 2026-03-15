# Design Gap: CSRF Token Rotation

## Severity: HIGH

## Problem

Most web applications protect mutation endpoints (POST, PUT, DELETE) with CSRF
tokens that are:
- Generated per session or per page load
- Embedded in HTML (meta tags, hidden form fields, SSR globals)
- Required as a custom header or form field on every mutating request
- Short-lived and rotate periodically

HAR captures one snapshot of CSRF tokens. By replay time, they are expired.

## Affected Sites (20+)

**From cookie:**
- Instagram — `csrftoken` cookie → `X-CSRFToken` header (read fresh every request)
- LeetCode — `csrftoken` cookie → `X-CSRFToken` header
- Bitbucket — `csrftoken` cookie → `X-CSRFToken` header
- PostHog — `posthog_csrftoken` cookie → `X-CSRFToken` header

**From page globals / SSR:**
- Airtable — `window.initData.csrfToken` → POST body `_csrf`
- Booking — SSR store JWT → `x-booking-csrf-token` header
- Cloudflare — `window.bootstrap.atok` (timestamp-prefixed, refreshes per page load)
- npm — `window.__context__.context.csrftoken` → `x-csrf-token` header
- MongoDB Atlas — `PARAMS.csrfToken`
- Stripe — `PRELOADED.csrf_token` → `x-stripe-csrf-token` header

**From meta tags:**
- Calendly — `<meta name="csrf-token">` → `X-CSRF-Token` header
- GitHub — `<input name="authenticity_token">` in form HTML

**From API response:**
- Reddit — `/api/me.json` returns `modhash` used as CSRF token

## Why OpenWeb Can't Handle It

1. HAR records CSRF tokens from the recording session — they expire before replay
2. Token extraction logic varies per site (cookie, meta tag, global, form field)
3. Some tokens rotate per-request (not just per-session)
4. OpenWeb's `direct_http` mode has no way to extract a fresh CSRF token
5. Even `session_http` mode needs to know where and how to extract the token

## Potential Mitigations

- **CSRF extraction annotation**: In the generated spec, annotate which endpoints
  need CSRF tokens and where to extract them (cookie name, meta tag selector,
  global path)
- **Pre-flight token fetch**: Before replaying a mutation, fetch the page to extract
  a fresh CSRF token (similar to how GitHub plugin does `submitPageForm`)
- **Cookie-based shortcut**: For sites using cookie → header pattern, the runtime
  can read the CSRF cookie and inject the header automatically
- **Classify in probing phase**: Phase 3 (Probe) should detect CSRF requirements
  by attempting mutations without tokens and detecting 403/419 responses
