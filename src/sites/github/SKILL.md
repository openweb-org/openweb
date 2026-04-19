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
| closeIssue | close an issue | owner, repo, issue_number ← listIssues | number, state, html_url | write, CAUTION. **BLOCKED — pending rewrite to github.com web endpoints** |
| reopenIssue | reopen a closed issue | owner, repo, issue_number ← listIssues | number, state, html_url | write, CAUTION — reverse of closeIssue. **BLOCKED — pending rewrite** |
| createComment | comment on issue/PR | owner, repo, issue_number ← listIssues, body | id, body, html_url | write, CAUTION |
| deleteComment | delete a comment | owner, repo, comment_id ← createComment | — (204) | write, CAUTION — reverse of createComment |
| forkRepo | fork a repository | owner ← getRepo, repo ← getRepo | full_name | write, CAUTION |
| starRepo | star a repository | owner ← getRepo, repo ← getRepo | — (204) | write, SAFE. **BLOCKED — pending rewrite to github.com web endpoints** |
| unstarRepo | unstar a repository | owner ← getRepo, repo ← getRepo | — (204) | write, CAUTION — reverse of starRepo. **BLOCKED — pending rewrite** |
| watchRepo | watch a repository | owner ← getRepo, repo ← getRepo | subscribed, ignored | write, CAUTION. **BLOCKED — pending rewrite to github.com web endpoints** |
| unwatchRepo | unwatch a repository | owner ← getRepo, repo ← getRepo | — (204) | write, CAUTION — reverse of watchRepo. **BLOCKED — pending rewrite** |
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

- **`closeIssue`, `reopenIssue`, `starRepo`, `unstarRepo`, `watchRepo`, `unwatchRepo` — BLOCKED, pending rewrite to github.com web endpoints.** These ops currently target `api.github.com`, which does not authenticate the user's `_gh_sess` cookie for writes (the github.com web UI calls api.github.com with a short-lived internal bearer token, not the session cookie). All openweb sites use cookie-based browser auth — no Bearer/PAT primitives — so the fix is to retarget these ops at the rails-style github.com web endpoints (e.g. `POST /{owner}/{repo}/star` with `X-CSRF-Token` from `<meta name="csrf-token">` on the github.com page), the same approach used for instagram, x, reddit, etc. Rewrite work is staged on the `w-github-web-rewrite` agent, paused on a user action (sign in to github.com in the managed Chrome at `localhost:9222`). See DOC.md and `doc/todo/write-verify/handoff.md` §3.1.
- `createIssue`, `createComment`, `deleteComment`, `forkRepo`, `graphqlQuery` likely share the same auth-architecture mismatch and will need the same rewrite.
- Read ops on public repos work without auth (rate-limited to 60 req/h); authenticated read ops via cookies work too (5000 req/h).
