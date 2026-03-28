# LinkedIn

## Overview
Professional social network. Archetype: social.

## Target Intents
- [x] Search people by keyword — `voyagerIdentityDashProfiles` (GraphQL)
- [x] Search jobs by keyword — `voyagerJobsDashJobCards` (GraphQL)
- [x] Search content/posts by keyword — `voyagerLegoDashPageContents` (GraphQL)
- [x] Get person profile details — `voyagerIdentityDashProfiles` (GraphQL), REST `/identity/dash/profiles/{id}`
- [x] Get job posting details — `voyagerJobsDashJobPostingDetailSections` (GraphQL)

## API Architecture
- **Voyager GraphQL** (`/voyager/api/graphql`) — primary data API, 33 distinct operations detected
- **Voyager REST** (`/voyager/api/...`) — secondary REST endpoints (identity, messaging, relationships, jobs)
- **RSC** (`/flagship-web/rsc-action/actions/...`) — React Server Components for feed and UI
- **Platform** (`platform.linkedin.com`) — feature flags and allowlists
- Data comes from API calls, not SSR embedded JSON

## Auth
- Confirmed: `cookie_session` + `cookie_to_header` CSRF
- Login required — 56/69 verify attempts returned 403
- CSRF: `JSESSIONID` cookie -> `csrf-token` header (auto-detection picked wrong cookie, needs manual fix)

## Transport
- Page transport recommended — status 999 bot detection confirmed on profile pages, custom signing suspected

## Known Issues
- Status 999 (bot detection) on profile HTML pages
- Heavy bot detection (TLS fingerprinting, rate limiting)
- 85 operations generated, most are background/supporting — curation needed to focus on 5 target intents
