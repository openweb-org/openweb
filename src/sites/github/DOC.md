# GitHub

## Overview
GitHub REST + GraphQL API — code hosting platform.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getRepo | get repository details | GET /repos/{owner}/{repo} | verified |
| listIssues | list repo issues | GET /repos/{owner}/{repo}/issues | `link_header` pagination, verified |
| createIssue | create an issue | POST /repos/{owner}/{repo}/issues | write op, returns 201 |
| searchRepos | search repositories by keyword | GET /search/repositories?q= | `link_header` pagination, sort by stars/forks/updated |
| getUserProfile | get user profile | GET /users/{username} | public profile info |
| getRepoReadme | get repository README | GET /repos/{owner}/{repo}/readme | returns base64-encoded content |
| listPullRequests | list repo pull requests | GET /repos/{owner}/{repo}/pulls | `link_header` pagination, filter by state |
| listContributors | list repo contributors | GET /repos/{owner}/{repo}/contributors | `link_header` pagination |
| forkRepo | fork a repository | POST /repos/{owner}/{repo}/forks | write op, returns 202 |
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
- `starRepo`, `graphqlQuery`, and all new ops are unverified (verified: false) — verify command crashes with exit code 13 (pre-existing issue)
- `graphqlQuery` is `write` permission since arbitrary mutations are possible
- `createIssue` and `forkRepo` are write ops — use only in safe/test contexts
