# Design Gap: Google gapi.client Proxy Layer

## Severity: CRITICAL (for Google services)

## Problem

Google's web applications use `gapi.client.request()` — a browser-only JavaScript
proxy that handles authentication internally. This proxy:
1. Reads the `SAPISID` cookie
2. Generates a `SAPISIDHASH` header: `SHA-1(timestamp + " " + SAPISID + " " + origin)`
3. Injects the hash into every request automatically
4. Routes requests through Google's internal API gateway

Without the gapi proxy, direct HTTP calls to Google APIs fail authentication.

## Affected Sites

- **Google Analytics** — `gapi.client.request()` for all analytics data
- **Google Calendar** — `gapi.client.request()` for event CRUD
- **Google Drive** — `gapi.client.request()` for file operations
- **Google Cloud** — `gapi.client.request()` for resource management
- **Google Maps** (partial) — Some features use gapi

All 5 plugins read API keys from page globals (`preload.globals.gmsSuiteApiKey`
or hardcoded) and call `gapi.client.setApiKey()` before making requests.

## Why OpenWeb Can't Handle It

1. `gapi.client.request()` is a browser-only runtime — not a standard HTTP call
2. SAPISIDHASH is time-based cryptographic signature (see gap #004) — stale
   signatures fail authentication
3. The `SAPISID` cookie is HttpOnly in some contexts — not readable by JS or
   capturable in HAR
4. gapi handles auth refresh, error retry, and batching internally — HAR only
   sees the final HTTP request
5. Google APIs called without SAPISIDHASH or with an invalid hash return 401
6. This affects ALL authenticated Google web services

## Potential Mitigations

- **SAPISIDHASH implementation**: Implement the SAPISIDHASH algorithm in the
  runtime executor (algorithm is publicly known). Requires access to SAPISID cookie.
- **Browser-only mode for Google**: Always use `browser_fetch` for Google services
  to let the gapi proxy handle auth naturally
- **Google API OAuth alternative**: For some Google APIs, use standard OAuth 2.0
  access tokens instead of SAPISIDHASH. This requires a separate OAuth flow but
  bypasses the gapi proxy entirely.
- **Detect and skip**: During probing (Phase 3), detect Google gapi dependency and
  automatically classify these endpoints as `browser_fetch` only
