# LinkedIn

## Overview
Professional networking platform — social media archetype with Voyager REST/GraphQL API.

## Workflows

### Look up a person's profile
1. `getProfile(vanityName)` → profile data with URN
2. `getProfileByUrn(id, decorationId)` → full profile with experience, education, skills

### Browse feed and news
1. `getFeed(queryId, variables)` → posts, articles, shares
2. `getNewsStorylines(queryId, variables)` → trending topics, curated news

### Search people, jobs, or content
Search is not yet supported — queryIds rotate with LinkedIn deploys and the captured queryId was stale.

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
| getProfile | get profile by vanity name | vanityName (URL slug) | name, headline, location, industry | via GraphQL |
| getProfileByUrn | get full profile by URN | id ← getMe/getProfile, decorationId | experience, education, skills | FullProfile-76 decoration |
| getFeed | get main feed | count, sortOrder | posts, shares, author info, engagement | via GraphQL |
| getConnectionsSummary | connection counts | — | total connections, new count | |
| getInvitations | pending invites | q=receivedInvitation, count, start | sender info, shared connections | paginated |
| getNotificationCards | notifications | decorationId, count, q | likes, comments, mentions, job alerts | |
| getNewsStorylines | trending news | — | topics, articles, industry updates | via GraphQL |
| getCompany | company page | universalName (URL slug) | name, industry, size, followers | via GraphQL |
| getMyNetworkNotifications | network updates | — | connection suggestions | |

## Quick Start

```bash
# Get own profile
openweb linkedin exec getMe '{}'

# Get someone's profile by vanity name
openweb linkedin exec getProfile '{"queryId":"voyagerIdentityDashProfiles.34ead06db82a2cc9a778fac97f69ad6a","variables":"(vanityName:williamhgates)"}'

# Get main feed
openweb linkedin exec getFeed '{"queryId":"voyagerFeedDashMainFeed.923020905727c01516495a0ac90bb475","variables":"(count:10,sortOrder:RELEVANCE)"}'

# Get company info
openweb linkedin exec getCompany '{"queryId":"voyagerOrganizationDashCompanies.148b1aebfadd0a455f32806df656c3c1","variables":"(universalName:microsoft)"}'

# Get connection invitations
openweb linkedin exec getInvitations '{"q":"receivedInvitation","count":10,"start":0}'

# Get notification cards
openweb linkedin exec getNotificationCards '{"decorationId":"com.linkedin.voyager.dash.deco.identity.notifications.CardsCollectionWithInjectionsNoPills-24","q":"filterVanityName","count":10}'
```

---

## Site Internals

## API Architecture
LinkedIn uses a hybrid Voyager REST + GraphQL API:
- **REST endpoints**: `/voyager/api/me`, `/voyager/api/relationships/*`, `/voyager/api/identity/dash/*`
- **GraphQL endpoints**: `/voyager/api/graphql` with `queryId` parameter for operation dispatch
- **Messaging GraphQL**: Separate endpoint at `/voyager/api/voyagerMessagingGraphQL/graphql`
- Parameters use Rest.li tuple syntax: `(key:value,nested:(a:1,b:2))` not JSON
- Responses use LinkedIn normalized JSON format with `included` array for referenced entities

## Auth
- **Type**: `cookie_session` with CSRF
- **CSRF**: `cookie_to_header` — JSESSIONID cookie value → `csrf-token` header
- **CSRF scope**: ALL methods including GET (unusual — most sites only require CSRF on mutations)
- **Key cookies**: `li_at` (auth token), `JSESSIONID` (session/CSRF), `liap` (premium flag)

## Transport
- **Default**: `page` — LinkedIn uses PerimeterX bot detection (`_px3` cookie); page transport needed for reliable access
- All operations use page transport (browser-fetch with cookie session)

## Known Issues
- **GraphQL queryIds are versioned**: queryIds rotate with LinkedIn deploys. If operations start returning HTTP 400, re-capture to get fresh queryIds.
- **Rest.li tuple encoding**: Variables must use LinkedIn's tuple format `(key:value)`, not JSON. Nested tuples and List() are supported.
- **Decoration IDs**: Profile and notification endpoints use `decorationId` to control response depth. Wrong decoration may return partial data.
