# Yelp

## Overview
Local business search and review platform. E-commerce archetype (per archetypes.md).

## Operations
No fixture operations yet — CAPTCHA-blocked.

Target intents (not yet captured):

| Intent | Expected Method | Status |
|--------|----------------|--------|
| Search businesses by location/keyword | SSR embedded or GraphQL | Blocked (DataDome) |
| Get business details | SSR embedded or GraphQL | Blocked (DataDome) |
| Get business reviews | SSR embedded or GraphQL | Blocked (DataDome) |

One public endpoint works:

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/search_suggest/v2/prefetch` | GET `?prefix=&loc=` | Autocomplete suggestions only — no business data |

## API Architecture
- **SSR-first**: Business data embedded in HTML via `window.yelp.react_root_props` — no separate REST endpoints for search/detail
- **GraphQL**: `/gql/batch` endpoint exists (batch array format) but returns 403 without session cookies
- **Fusion API v3**: `api.yelp.com/v3/` is a separate public API requiring Bearer token (API key registration)
- **Autocomplete**: `/search_suggest/v2/prefetch?prefix=&loc=` is the only publicly accessible JSON endpoint

## Auth
- Public browsing uses SSR HTML (no explicit auth for read-only)
- GraphQL `/gql/batch` requires session cookies (403 without them)
- Fusion API v3 requires registered API key (`Authorization: Bearer <key>`)

## Transport
- Would need `page` transport (SSR extraction from `window.yelp.react_root_props`)
- Autocomplete could use `node` transport (no auth needed)

## Extraction
- SSR: data in `window.yelp.react_root_props` JavaScript global
- Not `__NEXT_DATA__` (Yelp is not Next.js)

## Known Issues
- **DataDome CAPTCHA**: All HTML pages and the GraphQL endpoint are protected by DataDome bot detection. Both headless Chrome (Playwright) and curl requests receive 403 with a CAPTCHA challenge page from `geo.captcha-delivery.com`
- **Headless detection**: Page title shows "yelp.com" (generic) instead of the real page title; body contains only DataDome iframe
- **To unblock**: Need a real browser session with DataDome clearance (human CAPTCHA solve), or a Yelp Fusion API key
