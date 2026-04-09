# Facebook

## Overview
Social network (Meta). News feed, profiles, groups, events, marketplace.

## Workflows

### Look up a user profile
1. `getProfile(username)` → name, bio, follower/friend counts, work/education, verification

### Browse news feed
1. `getFeed(count)` → posts with text, author, reactions, comments, shares, attachments
2. `getFeed(count, cursor)` → next page (cursor from `end_cursor`)

### Search public posts
1. `searchPosts(query, count)` → matching posts with text, author, reaction counts
2. `searchPosts(query, count, cursor)` → next page (cursor from `end_cursor`)

### Browse upcoming events
1. `getEvents(count)` → events with name, date, location, attendee counts
2. `getEvents(count, cursor)` → next page (cursor from `end_cursor`)

### List user's groups
1. `getGroups(count)` → groups with name, member count, privacy, recent activity
2. `getGroups(count, cursor)` → next page (cursor from `end_cursor`)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getProfile | view user profile | username | id, name, bio, follower_count, is_verified | entry point |
| getFeed | browse news feed | count, cursor | posts with text, author, reactions, attachments | paginated via end_cursor |
| searchPosts | search public posts | query | posts with text, author, reaction_count | paginated via end_cursor |
| getEvents | browse events | count, cursor | events with name, start_time, location, going_count | paginated via end_cursor |
| getGroups | list user groups | count, cursor | groups with name, member_count, privacy | paginated via end_cursor |

## Quick Start

```bash
# Get a user profile
openweb facebook exec getProfile '{"username":"zuck"}'

# Get news feed (first page)
openweb facebook exec getFeed '{"count":10}'

# Search public posts
openweb facebook exec searchPosts '{"query":"artificial intelligence","count":10}'

# Get upcoming events
openweb facebook exec getEvents '{"count":10}'

# List user's groups
openweb facebook exec getGroups '{"count":10}'
```

---

## Site Internals

## API Architecture
- Internal GraphQL at `https://www.facebook.com/api/graphql/` (POST)
- All queries sent as form-encoded POST with `fb_dtsg`, `doc_id`, `variables`
- Public Graph API at `graph.facebook.com` requires OAuth — not used here
- `fb_api_req_friendly_name` identifies the query type; `doc_id` is the query hash

## Auth
- `cookie_session` — session cookies from logged-in browser (`c_user`, `xs`, `datr`)
- CSRF: `fb_dtsg` token extracted from page JS (`require("DTSGInitData")` or `__eqmc` global)
- Adapter resolves `fb_dtsg` at runtime from page context
- All operations require authenticated session — public profiles return minimal data without login

## Transport
- `page` — Meta bot detection blocks all non-browser HTTP requests (aggressive TLS fingerprinting, same system as Instagram)
- All operations use adapter (`facebook-graphql`) — GraphQL POST with doc_id + fb_dtsg
- Page URL: `https://www.facebook.com/`

## Known Issues
- Meta bot detection: aggressive TLS fingerprinting, same infrastructure as Instagram — blocks all non-browser requests
- GraphQL `doc_id` hashes rotate with every deploy — adapter discovers them from page script bundles at runtime
- `fb_dtsg` token is session-scoped and changes on page reload — adapter extracts fresh value per execution
- Feed content is highly personalized to the logged-in user — results are not reproducible across accounts
- `searchPosts` only returns posts matching Facebook's relevance algorithm — not a full-text search
- `getEvents` scope depends on user's location, groups, and pages — varies by account
- `getGroups` only returns groups the authenticated user is a member of
- Rate limiting: Facebook applies per-account rate limits; rapid calls may trigger temporary blocks
- Profile data depth varies: public profiles show limited info; friend profiles show more detail
- Response shapes may change without notice as Facebook deploys new frontend code
