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

### Manage issues
1. `listIssues(owner, repo)` → find issue number
2. `closeIssue(owner, repo, issue_number)` → close it
3. `reopenIssue(owner, repo, issue_number)` → reopen if needed
4. `createComment(owner, repo, issue_number, body)` → add a comment
5. `deleteComment(owner, repo, comment_id)` → remove a comment

### Star / watch a repo
1. `starRepo(owner, repo)` → star it
2. `unstarRepo(owner, repo)` → unstar it
3. `watchRepo(owner, repo)` → subscribe to notifications
4. `unwatchRepo(owner, repo)` → unsubscribe

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchRepos | find repositories | q | total_count, items[].full_name, stargazers_count, language | entry point, paginated |
| getRepo | repository details | owner, repo | full_name, description, stargazers_count, forks_count, language | entry point |
| getUserProfile | user profile | username | login, name, bio, public_repos, followers, following | entry point |
| getRepoReadme | repository README | owner ← getRepo, repo ← getRepo | name, content (base64), encoding | |
| listIssues | repository issues | owner ← getRepo, repo ← getRepo | number, title, state, user.login, labels | paginated |
| listPullRequests | repository PRs | owner ← getRepo, repo ← getRepo | number, title, state, user.login, head.ref, base.ref | paginated |
| listContributors | repository contributors | owner ← getRepo, repo ← getRepo | login, contributions | paginated |
| createIssue | create an issue | owner ← getRepo, repo ← getRepo, title, body | number, html_url | write, CAUTION |
| closeIssue | close an issue | owner, repo, issue_number ← listIssues | number, state, html_url | write, CAUTION |
| reopenIssue | reopen a closed issue | owner, repo, issue_number ← listIssues | number, state, html_url | write, CAUTION — reverse of closeIssue |
| createComment | comment on issue/PR | owner, repo, issue_number ← listIssues, body | id, body, html_url | write, CAUTION |
| deleteComment | delete a comment | owner, repo, comment_id ← createComment | — (204) | write, CAUTION — reverse of createComment |
| forkRepo | fork a repository | owner ← getRepo, repo ← getRepo | full_name | write, CAUTION |
| starRepo | star a repository | owner ← getRepo, repo ← getRepo | — (204) | write, SAFE |
| unstarRepo | unstar a repository | owner ← getRepo, repo ← getRepo | — (204) | write, CAUTION — reverse of starRepo |
| watchRepo | watch a repository | owner ← getRepo, repo ← getRepo | subscribed, ignored | write, CAUTION |
| unwatchRepo | unwatch a repository | owner ← getRepo, repo ← getRepo | — (204) | write, CAUTION — reverse of watchRepo |
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

# Close an issue
openweb github exec closeIssue '{"owner":"imoonkey","repo":"openweb-test","issue_number":1,"state":"closed"}'

# Comment on an issue
openweb github exec createComment '{"owner":"imoonkey","repo":"openweb-test","issue_number":1,"body":"Looks good!"}'

# Star / unstar a repo
openweb github exec starRepo '{"owner":"imoonkey","repo":"openweb-test"}'
openweb github exec unstarRepo '{"owner":"imoonkey","repo":"openweb-test"}'

# Watch / unwatch a repo
openweb github exec watchRepo '{"owner":"imoonkey","repo":"openweb-test"}'
openweb github exec unwatchRepo '{"owner":"imoonkey","repo":"openweb-test"}'
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
- Write ops (`closeIssue`, `reopenIssue`, `createIssue`, `createComment`,
  `deleteComment`, `forkRepo`, `starRepo`, `unstarRepo`, `watchRepo`,
  `unwatchRepo`) currently **do not work** via the `cookie_session` +
  `meta_tag` csrf path declared on the `api.github.com` server. Two
  upstream constraints block them:
  1. `api.github.com` returns JSON, not HTML — there is no `csrf-token`
     meta tag to read, so `meta_tag` csrf resolution always fails.
  2. `api.github.com` does not accept `_gh_sess` web cookies for write
     operations from non-github.com origins; the github.com web UI
     uses an internal short-lived bearer token (not the session cookie)
     when calling the REST API.
  Path forward: rewrite write ops to target the rails-style endpoints
  on `github.com` itself (e.g. `POST /{owner}/{repo}/star` with form
  body + csrf from the github.com page), OR add a `personal_access_token`
  auth primitive driven by an env var. Tracked separately from the
  normalize-adapter milestone.
- Read ops on public repos work without auth (rate-limited to 60 req/h);
  authenticated read ops via cookies work too (5000 req/h).
- `graphqlQuery` has `write` permission since arbitrary mutations are
  possible via the query string. Same auth blocker as above for any
  mutation use.
- `closeIssue` and `reopenIssue` both PATCH the same endpoint
  (`/repos/{owner}/{repo}/issues/{issue_number}`) — `reopenIssue` uses
  a virtual path key with `actual_path` override.
- `deleteComment` requires the numeric `comment_id` (from
  `createComment` response `.id`), not the issue number.
