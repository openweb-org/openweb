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
1. `searchRepos(q)` → `owner`, `repo` from `full_name` (or use known repo)
2. `createIssue(owner, repo, title, body)` → `number`, `html_url`

### Manage issues
1. `listIssues(owner, repo)` → `issue_number`, `title`, `state`
2. `closeIssue(owner, repo, issue_number ← listIssues)` → `state: "closed"`
3. `reopenIssue(owner, repo, issue_number ← listIssues)` → `state: "open"`
4. `createComment(owner, repo, issue_number ← listIssues, body)` → `comment_id`, `html_url`
5. `deleteComment(owner, repo, comment_id ← createComment)` → 204

### Star / watch a repo
1. `searchRepos(q)` → `owner`, `repo` from `full_name`
2. `starRepo(owner, repo)` → 204
3. `unstarRepo(owner, repo)` → 204
4. `watchRepo(owner, repo)` → `subscribed`
5. `unwatchRepo(owner, repo)` → 204

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
| closeIssue | close an issue | owner, repo, issue_number ← listIssues | data (GraphQL response) | write, CAUTION. Routes through github.com `/_graphql` |
| reopenIssue | reopen a closed issue | owner, repo, issue_number ← listIssues | data (GraphQL response) | write, CAUTION — reverse of closeIssue. Routes through github.com `/_graphql` |
| createComment | comment on issue/PR | owner, repo, issue_number ← listIssues, body | id, body, html_url | write, CAUTION |
| deleteComment | delete a comment | owner, repo, comment_id ← createComment | — (204) | write, CAUTION — reverse of createComment |
| forkRepo | fork a repository | owner ← getRepo, repo ← getRepo | full_name | write, CAUTION |
| starRepo | star a repository | owner ← getRepo, repo ← getRepo | — (204) | write, SAFE. (api.github.com — currently rejected by cookie_session, see DOC.md) |
| unstarRepo | unstar a repository | owner ← getRepo, repo ← getRepo | count (watcher count) | write, CAUTION — reverse of starRepo. Routes through github.com rails endpoint |
| watchRepo | watch a repository | owner ← getRepo, repo ← getRepo | count (watcher count) | write, CAUTION. Routes through github.com `/notifications/subscribe` |
| unwatchRepo | unwatch a repository | owner ← getRepo, repo ← getRepo | count (watcher count) | write, CAUTION — reverse of watchRepo. Routes through github.com `/notifications/subscribe` |
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

## Known Limitations

- **`closeIssue`, `reopenIssue`, `watchRepo`, `unwatchRepo`, `unstarRepo` route through github.com web UI** (transport: page) instead of api.github.com REST. They use the user's `_gh_sess` browser cookie + page-scraped `X-Fetch-Nonce` + per-form `authenticity_token`. Verify: 5/5 PASS (2026-04-19). The persisted-query hashes for close/reopen are hardcoded and **will drift** with GitHub web releases — re-capture from a real click via DevTools `_graphql` request when they break.
- **`starRepo`, `createIssue`, `createComment`, `deleteComment`, `forkRepo`, `graphqlQuery` still target api.github.com** and remain affected by the cookie-session/Bearer mismatch. Same web-rewrite pattern applies (see `adapters/github-web.ts`).
- Read ops on public repos work without auth (rate-limited to 60 req/h); authenticated read ops via cookies work too (5000 req/h).
