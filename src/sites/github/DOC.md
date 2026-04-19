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
| closeIssue | close an issue | owner, repo, issue_number ← listIssues | data (GraphQL) | write, CAUTION. Routes through github.com `/_graphql` |
| reopenIssue | reopen a closed issue | owner, repo, issue_number ← listIssues | data (GraphQL) | write, CAUTION — reverse of closeIssue. Routes through github.com `/_graphql` |
| createComment | comment on issue/PR | owner, repo, issue_number ← listIssues, body | id, body, html_url | write, CAUTION |
| deleteComment | delete a comment | owner, repo, comment_id ← createComment | — (204) | write, CAUTION — reverse of createComment |
| forkRepo | fork a repository | owner ← getRepo, repo ← getRepo | full_name | write, CAUTION |
| starRepo | star a repository | owner ← getRepo, repo ← getRepo | — (204) | write, SAFE. Still on api.github.com — broken |
| unstarRepo | unstar a repository | owner ← getRepo, repo ← getRepo | count | write, CAUTION — reverse of starRepo. Routes through github.com rails `/unstar` |
| watchRepo | watch a repository | owner ← getRepo, repo ← getRepo | count | write, CAUTION. Routes through github.com `/notifications/subscribe` |
| unwatchRepo | unwatch a repository | owner ← getRepo, repo ← getRepo | count | write, CAUTION — reverse of watchRepo. Routes through github.com `/notifications/subscribe` |
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
Mixed:
- **node** — read ops + the still-broken `api.github.com` writes (starRepo, createIssue, createComment, deleteComment, forkRepo, graphqlQuery).
- **page** + adapter `github-web` — the 5 verified write ops (closeIssue, reopenIssue, watchRepo, unwatchRepo, unstarRepo) on `https://github.com` web UI. Per-op `servers:` override + `page_plan.entry_url` lands the page on a logged-in github.com context (where `_gh_sess`, `meta[fetch-nonce]`, and per-form `authenticity_token` are all available).

## Adapter Patterns — `github-web`

GitHub web has three coexisting endpoint flavors. The adapter handles all three from a single page context:

1. **Rails-form endpoints** (star/unstar): scrape `authenticity_token` from `form[action$="/unstar"] input[name="authenticity_token"]`, POST multipart to `/<owner>/<repo>/unstar`, body `{authenticity_token, context: "repository"}`.
2. **Rails-no-form endpoints** (notifications subscribe): no per-form token, but `X-Fetch-Nonce` is required. POST multipart to `/notifications/subscribe`, body `{do, "thread_types[]": "", repository_id}` where `repository_id` comes from `meta[name="octolytics-dimension-repository_id"]`. `do=subscribed` watches All Activity, `do=included` reverts to default Participating (effectively "unwatch").
3. **Persisted-query GraphQL** (close/reopen issue): POST to `/_graphql`, body `{persistedQueryName, query: <md5-hash>, variables: {id: <node-id>}}`. The issue's GraphQL global node id (`I_kwDO…`) is regex-extracted from page HTML; the persisted-query hashes are hardcoded in the adapter and **will drift** with GitHub web releases.

All three flavors require the same envelope of headers:
- `X-Fetch-Nonce: <meta[name=fetch-nonce] content>` — per-page nonce
- `GitHub-Verified-Fetch: true`
- `X-Requested-With: XMLHttpRequest`
- `Accept: application/json`

Without the nonce + verified-fetch header, every endpoint returns 403. This is GitHub's CSRF guard and replaces the old global `meta[name="csrf-token"]` (which no longer exists on modern github.com pages).

## Known Issues

### Persisted-query hash drift (close/reopen issue)
`closeIssue` (`updateIssueStateMutationCloseMutation` / `73f1d13c27e76443f6a9a809ccb4f6e6`) and `reopenIssue` (`updateIssueStateMutation` / `a6677fa25f66fdc23d4dbe44f4e62757`) hashes captured 2026-04-19. When GitHub bumps these, verify will return 4xx from `/_graphql`. To re-capture: open an issue in DevTools, click Close issue, inspect the `_graphql` POST body — `persistedQueryName` and `query` (md5) fields are what to update in `adapters/github-web.ts`.

### api.github.com cookie-mismatch (still affects starRepo/createIssue/createComment/deleteComment/forkRepo/graphqlQuery)
The github.com web UI calls `api.github.com` using a short-lived **internal bearer token** synthesized server-side, NOT the `_gh_sess` cookie. cookie_session writes against api.github.com therefore always fail. The 5 fixed ops route around this via the github.com web UI; the remaining 6 will need the same treatment.

### Other notes
- Read ops on public repos work without auth (rate-limited to 60 req/h); authenticated read ops via cookies work too (5000 req/h).
- `closeIssue` and `reopenIssue` both PATCH the same conceptual endpoint (`/repos/{owner}/{repo}/issues/{issue_number}`) — `reopenIssue` uses a virtual path key with `actual_path` override.
- `deleteComment` requires the numeric `comment_id` (from `createComment` response `.id`), not the issue number.

## Probe Results (2026-04-19)

Captured from real DevTools network on `imoonkey/openweb-test`:

| Action | Endpoint | Body shape | Response shape |
|---|---|---|---|
| unstar | `POST /<owner>/<repo>/unstar` | multipart `authenticity_token` + `context=repository` | (text — adapter returns parsed JSON if any, else string) |
| watch (All Activity) | `POST /notifications/subscribe` | multipart `do=subscribed`, `thread_types[]=`, `repository_id=<id>` | `{count: "1"}` |
| unwatch (Participating default) | `POST /notifications/subscribe` | multipart `do=included` (other fields same) | `{count: "1"}` |
| close issue | `POST /_graphql` | `{persistedQueryName: "updateIssueStateMutationCloseMutation", query: "73f1d13c…", variables: {id, newStateReason: "COMPLETED", duplicateIssueId: null}}` | `{data: {…}}` |
| reopen issue | `POST /_graphql` | `{persistedQueryName: "updateIssueStateMutation", query: "a6677fa…", variables: {id}}` | `{data: {…}}` |
