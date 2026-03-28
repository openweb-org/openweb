# LinkedIn

## Overview
Professional social network. Archetype: social.

## Operations

| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| voyager_identity_profiles | Search/get person profile | GET /voyager/api/graphql | GraphQL, queryId=voyagerIdentityDashProfiles, variables=(memberIdentity:...) |
| get_voyager_identity_normalizedprofile | Get person profile details | GET /voyager/api/identity/normalizedProfiles/{id} | REST, returns full profile |
| list_voyager_voyagerjobsdashjobcards | Search jobs by keyword | GET /voyager/api/voyagerJobsDashJobCards | REST, q=jobSearch, query=(keywords:...) |
| voyager_jobs_job_postings | Get job posting details | GET /voyager/api/graphql | GraphQL, queryId=voyagerJobsDashJobPostings, variables=(jobPostingUrn:urn%3Ali%3Afsd_jobPosting%3A...) |
| voyager_jobs_job_posting_detail_sections | Get job posting sections | GET /voyager/api/graphql | GraphQL, queryId=voyagerJobsDashJobPostingDetailSections |
| voyager_lego_page_contents | Search content/posts | GET /voyager/api/graphql | GraphQL, queryId=voyagerLegoDashPageContents, variables=(pageKey:...,slotId:...) |

## API Architecture
- **Voyager GraphQL** (`/voyager/api/graphql`) — primary data API with persisted queries via `queryId` param
- **Voyager REST** (`/voyager/api/...`) — REST endpoints for jobs, identity, messaging
- **RSC** (`/flagship-web/rsc-action/actions/...`) — React Server Components for feed and UI
- Variables use LinkedIn's custom format: `(key:value,key2:value2)` not JSON
- URN values within variables must have colons encoded: `urn%3Ali%3Afsd_jobPosting%3A123`
- queryId hashes are persisted query IDs tied to server deployments; may change over time

## Auth
- Type: `cookie_session` + `cookie_to_header` CSRF
- CSRF: `JSESSIONID` cookie value → `csrf-token` header (strip quotes from cookie value)
- Auto-detection picked wrong CSRF (`lc-main` → `x-li-lang` locale cookie) — manual override required
- Login required for all Voyager API endpoints

## Transport
- `page` transport required — LinkedIn uses bot detection (status 999) and custom request signing
- Requires an open LinkedIn tab in the managed browser

## Known Issues
- Status 999 (bot detection) on HTML page requests with node transport
- CSRF auto-detection fails — always picks locale cookie instead of JSESSIONID
- GraphQL queryId hashes change with LinkedIn deploys — may need periodic re-capture
- URLSearchParams over-encodes `( ) ,` which LinkedIn rejects — fixed in runtime with minimal encoding
- 71 operations compiled but only ~6 are target intents; rest are supporting/background ops
- Some GraphQL operations return 400 if URN colons are not percent-encoded
