# LinkedIn

## Overview
Professional networking platform — social media archetype with Voyager REST/GraphQL API.

## Workflows

### Look up a person's profile
1. `getProfile(variables)` → profile data with URN
2. `getProfileByUrn(id, decorationId)` → full profile with experience, education, skills

### Browse feed and news
1. `getFeed(variables)` → posts, articles, shares
2. `getNewsStorylines(variables)` → trending topics, curated news

### Search people, jobs, or content
1. `searchGeo(keywords)` → geo results → `geoId` (from `included[].entityUrn` suffix)
2. `searchJobs(keywords, geoId?, count?, start?)` → job cards with titles, companies, locations
3. `getJobDetail(jobId)` → full posting with description, requirements, salary

### Check connections and invitations
1. `getConnectionsSummary()` → total count, new connections
2. `getInvitations(q, count, start)` → pending invites with sender info
3. `getMyNetworkNotifications()` → connection suggestions

### Check notifications
1. `getNotificationCards(decorationId, q, count)` → likes, comments, mentions, job alerts

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getMe | get own profile | — | name, headline, profileUrn | entry point |
| getProfile | get profile by vanity name | vanityName (URL slug) | name, headline, location, industry | via GraphQL adapter |
| getProfileByUrn | get full profile by URN | id ← getMe/getProfile, decorationId | experience, education, skills | FullProfile-76 decoration |
| getFeed | get main feed | count, sortOrder | posts, shares, author info, engagement | via GraphQL adapter |
| getConnectionsSummary | connection counts | — | total connections, new count | |
| getInvitations | pending invites | q=receivedInvitation, count, start | sender info, shared connections | paginated |
| getNotificationCards | notifications | decorationId, count, q | likes, comments, mentions, job alerts | |
| getNewsStorylines | trending news | — | topics, articles, industry updates | via GraphQL adapter |
| getCompany | company page | universalName (URL slug) | name, industry, size, followers | via GraphQL adapter |
| getMyNetworkNotifications | network updates | — | connection suggestions | |
| searchGeo | search geo IDs | keywords (location name) | geo URNs with geoId | use geoId with searchJobs |
| searchJobs | search for jobs | keywords, geoId?, count?, start? | job cards: title, company, location, posting date | via GraphQL adapter |
| getJobDetail | get job posting details | jobId ← searchJobs or URL | description, requirements, company, salary, applicants | via GraphQL adapter |

## Quick Start

```bash
# Get own profile
openweb linkedin exec getMe '{}'

# Get someone's profile by vanity name
openweb linkedin exec getProfile '{"variables":"(vanityName:williamhgates)"}'

# Get main feed
openweb linkedin exec getFeed '{"variables":"(count:10,sortOrder:RELEVANCE)"}'

# Get company info
openweb linkedin exec getCompany '{"variables":"(universalName:microsoft)"}'

# Get connection invitations
openweb linkedin exec getInvitations '{"q":"receivedInvitation","count":10,"start":0}'

# Get notification cards
openweb linkedin exec getNotificationCards '{"decorationId":"com.linkedin.voyager.dash.deco.identity.notifications.CardsCollectionWithInjectionsNoPills-24","q":"filterVanityName","count":10}'

# Search for jobs
openweb linkedin exec searchJobs '{"keywords":"software engineer","geoId":"103644278","count":25}'

# Look up a geoId by location name
openweb linkedin exec searchGeo '{"keywords":"San Francisco Bay Area"}'

# Get job posting details
openweb linkedin exec getJobDetail '{"jobId":"3945709057"}'
```

---

## Site Internals

### API Architecture
LinkedIn uses a hybrid Voyager REST + GraphQL API:
- **REST endpoints**: `/voyager/api/me`, `/voyager/api/relationships/*`, `/voyager/api/identity/dash/*`
- **GraphQL endpoints**: `/voyager/api/graphql` with `queryId` parameter for operation dispatch
- **Messaging GraphQL**: Separate endpoint at `/voyager/api/voyagerMessagingGraphQL/graphql`
- Parameters use Rest.li tuple syntax: `(key:value,nested:(a:1,b:2))` not JSON
- Responses use LinkedIn normalized JSON format with `included` array for referenced entities
- GraphQL `queryId` hashes are resolved dynamically by the adapter — callers only provide `variables`

### Auth
- **Type**: `cookie_session` with CSRF
- **CSRF**: `cookie_to_header` — JSESSIONID cookie value → `csrf-token` header
- **CSRF scope**: ALL methods including GET (unusual — most sites only require CSRF on mutations)
- **Key cookies**: `li_at` (auth token), `JSESSIONID` (session/CSRF), `liap` (premium flag)

### Transport
- **Default**: `page` — LinkedIn uses PerimeterX bot detection (`_px3` cookie); page transport needed for reliable access
- All operations use page transport (browser-fetch with cookie session)

### Adapter Patterns
- `adapters/linkedin-graphql.ts` is a `CustomRunner` exposing a single `run(ctx)` entry point — no `init()` or `isAuthenticated()` hooks (PagePlan handles navigation; auth-primitive resolution covers cookie semantics).
- Inside `run(ctx)`, op handlers branch on `ctx.opName`, share a queryId cache, derive the CSRF header from JSESSIONID, and emit Rest.li tuple-formatted variables for GraphQL/REST calls.

### Known Issues
- **GraphQL queryIds are versioned**: queryIds rotate with LinkedIn deploys. The adapter resolves them dynamically by scanning JS bundles, but if operations start returning HTTP 400, the bundle regex may need updating.
- **Rest.li tuple encoding**: Variables must use LinkedIn's tuple format `(key:value)`, not JSON. Nested tuples and List() are supported.
- **Decoration IDs**: Profile and notification endpoints use `decorationId` to control response depth. Wrong decoration may return partial data.
- **SDUI migration (2026-04)**: LinkedIn's job detail page migrated to Server-Driven UI (React Server Components). The Voyager GraphQL `full-job-posting-detail-section` API still works but `JOB_DESCRIPTION_CARD` must be included in `cardSectionTypes` to get descriptions. The `full-job-posting-detail-section` queryId is only in the jobs page bundles, not the feed page bundles — `cachedQueryIds` must be populated from a page that loads these bundles.
- **searchGeo uses REST endpoint**: `voyagerSearchDashReusableTypeahead` is a REST.li service, not a GraphQL registered query. Its registration in the bundle uses a service name mapping (`SearchDashReusableTypeahead:"voyagerSearchDashReusableTypeahead"`) rather than the `kind:"query"` pattern that `loadQueryIds` scans. The adapter uses `restGet` directly (like `searchJobs`), avoiding the GraphQL queryId resolution entirely.
