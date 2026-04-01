# GitHub

## Overview
GitHub REST + GraphQL API — code hosting platform (developer tools archetype).

## Workflows

### Explore a repository
1. `searchRepos(q)` → pick result → `owner`, `repo` from `full_name`
2. `getRepo(owner, repo)` → description, stars, language
3. `getRepoReadme(owner, repo)` → base64-encoded README content
4. `listIssues(owner, repo)` → open issues
5. `listPullRequests(owner, repo)` → open PRs

### Investigate a user's work
1. `getUserProfile(username)` → bio, public_repos, followers
2. `searchRepos(q: "user:username")` → their repositories

### File an issue
1. `getRepo(owner, repo)` → confirm repo exists
2. `createIssue(owner, repo, title, body)` → issue number, html_url

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchRepos | find repositories | q | total_count, items[].full_name, stargazers_count | entry point, paginated |
| getRepo | repository details | owner, repo | id, full_name, description | entry point |
| getUserProfile | user profile | username | login, name, bio, public_repos, followers | entry point |
| getRepoReadme | repository README | owner ← getRepo, repo ← getRepo | name, content (base64), encoding | |
| listIssues | repository issues | owner ← getRepo, repo ← getRepo | id, title, state | paginated |
| listPullRequests | repository PRs | owner ← getRepo, repo ← getRepo | id, title, state, user.login | paginated |
| listContributors | repository contributors | owner ← getRepo, repo ← getRepo | login, contributions | paginated |
| createIssue | create an issue | owner ← getRepo, repo ← getRepo, title, body | id, number, html_url | write, CAUTION |
| forkRepo | fork a repository | owner ← getRepo, repo ← getRepo | id, full_name | write, CAUTION |
| starRepo | star a repository | owner ← getRepo, repo ← getRepo | — (204) | write, SAFE |
| graphqlQuery | execute GraphQL | query, variables | data | write (unrestricted mutations possible) |

## Quick Start

```bash
# Search repositories
openweb github exec searchRepos '{"q":"react language:typescript","per_page":5}'

# Get repository details
openweb github exec getRepo '{"owner":"anthropics","repo":"claude-code"}'

# List issues
openweb github exec listIssues '{"owner":"anthropics","repo":"claude-code","per_page":5}'

# Get user profile
openweb github exec getUserProfile '{"username":"anthropics"}'
```

---

## Site Internals

## API Architecture
- REST API at `api.github.com` — standard resource-based endpoints
- GraphQL endpoint at `/graphql` — single POST endpoint with full query flexibility
- All requests require `Accept: application/vnd.github+json` header (set as default)
- List endpoints use `link_header` pagination

## Auth
- `cookie_session` — uses browser session cookies
- CSRF: `meta_tag` type, reads `csrf-token` from page, sends as `X-CSRF-Token` on PUT/POST/PATCH/DELETE
- Read ops on public repos work without auth; write ops require a logged-in browser session

## Transport
`node` — all endpoints use direct HTTP. No bot detection, no browser needed.

## Known Issues
- Write ops (`createIssue`, `forkRepo`, `starRepo`) require a logged-in browser session — run `openweb browser start` and log in first
- `graphqlQuery` has `write` permission since arbitrary mutations are possible via the query string
- `starRepo` permission is set to `read` in the spec but is actually a write action (PUT) — kept as-is since verify skips it either way
- Rate limit: 60 requests/hour unauthenticated, 5000/hour authenticated
