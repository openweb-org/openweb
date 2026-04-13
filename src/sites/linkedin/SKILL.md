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
1. `searchJobs(keywords, geoId?, count?, start?)` → job cards with titles, companies, locations
2. `getJobDetail(jobId)` → full posting with description, requirements, salary

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

# Get job posting details
openweb linkedin exec getJobDetail '{"jobId":"3945709057"}'
```
