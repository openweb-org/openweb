# GitHub

## Overview
GitHub REST + GraphQL API — code hosting platform.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getRepo | get repository details | GET /repos/{owner}/{repo} | |
| listIssues | list repo issues | GET /repos/{owner}/{repo}/issues | `link_header` pagination |
| starRepo | star a repository | PUT /user/starred/{owner}/{repo} | write op, returns 204 |
| graphqlQuery | execute GraphQL query | POST /graphql | `write` permission — unrestricted query string can carry mutations |

## API Architecture
- REST API at `api.github.com` — standard resource-based endpoints
- GraphQL endpoint at `/graphql` — single POST endpoint with full query flexibility
- Requires `Accept: application/vnd.github+json` header on all requests
- List endpoints use `link_header` pagination

## Auth
- `cookie_session` — uses browser session cookies
- CSRF: `meta_tag` type, reads `csrf-token`, sends as `X-CSRF-Token` on mutating methods

## Transport
- `node` — all endpoints use direct HTTP

## Known Issues
- `starRepo` and `graphqlQuery` are unverified (verified: false)
- `graphqlQuery` is `write` permission since arbitrary mutations are possible
