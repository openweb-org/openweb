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

### Auth-architecture mismatch — write ops blocked on api.github.com

`closeIssue`, `reopenIssue`, `createIssue`, `createComment`, `deleteComment`, `forkRepo`, `starRepo`, `unstarRepo`, `watchRepo`, `unwatchRepo` (and `graphqlQuery` for any mutation) all currently target `api.github.com` with `auth: cookie_session` + `csrf: meta_tag`. End-to-end this cannot work, for two upstream reasons:

1. `api.github.com` returns JSON, not HTML — there is no `<meta name="csrf-token">` to read, so `meta_tag` CSRF resolution always fails.
2. `api.github.com` does not accept the user's `_gh_sess` web cookie for writes from a non-github.com origin. The github.com web UI calls api.github.com using a short-lived **internal bearer token** synthesized server-side, NOT the session cookie that the browser holds.

**Project constraint:** all openweb sites authenticate via browser cookies (`cookie_session` family). There are no Bearer / Personal Access Token primitives, and adding them would break the uniform auth model. So the fix is **not** to add a PAT primitive — it is to **rewrite the write ops against the github.com web UI**.

**Planned rewrite (the github.com web path):**
- POST against rails-style endpoints on `github.com` itself (e.g. `POST https://github.com/{owner}/{repo}/star`, `POST https://github.com/{owner}/{repo}/subscription`, `POST https://github.com/{owner}/{repo}/issues/{n}/close`).
- Form-encoded body, `X-CSRF-Token` header read from `<meta name="csrf-token">` on the github.com page (the `_gh_sess` cookie + this token is exactly what the github.com web UI sends).
- Same architectural pattern used by instagram, x, reddit, weibo write ops.

**Status:** docs-only commit `be3a0a5` documented the blocker but did not rewrite. The `w-github-web-rewrite` agent has the loop staged (probe script left at `probe-gh.mjs` in the project root) and is **paused on a user action**: managed Chrome at `localhost:9222` is not signed in to github.com, so the agent cannot capture HAR for the rails endpoints. Once the user signs in, the agent (or a re-spawn with the same prompt at `/tmp/prompt-github.txt`) can resume. See `doc/todo/write-verify/handoff.md` §3.1 and §5 item 1.

**History (the flip-flop in commits `bf66525` → `723c3dc`).** On 2026-03-31 someone removed server-level `auth: cookie_session` and `csrf: meta_tag` (correct for the public read ops on api.github.com) — `bf66525`. 19 minutes later it was restored — `723c3dc`. Both edits were made without end-to-end write verification, because writes were always permission-gated and `verify --all` never exercised them. The 2026-04-18 write-verify campaign was the first run that actually tried to send a github write op end-to-end, which is when the auth-architecture mismatch surfaced. The current cookie_session/csrf config is left in place (despite being known-broken for writes against api.github.com) so that the auth-cascade behaviour — token cache, login prompt — continues to work for the eventual rewrite, where it will be correct.

**Layered blocker now removed.** Earlier sweeps were also tripping over a runtime cascade where `handleLoginRequired() → refreshProfile()` killed the managed Chrome and left `verify.ts` holding a stale `Browser` handle, so all subsequent ops failed instantly with "no browser context available". Fixed in `acc23ad` (`fix(runtime): don't inject pre-acquired Browser handle into verify deps`) — each op now re-reads the browser via `ensureBrowser()`. github writes still don't pass post-`acc23ad`, but failures now reach the auth attempt instead of crashing earlier — which is what surfaced the api.github.com cookie-mismatch as the true blocker.

### Other notes

- Read ops on public repos work without auth (rate-limited to 60 req/h); authenticated read ops via cookies work too (5000 req/h).
- `graphqlQuery` carries `write` permission since arbitrary mutations are possible via the query string. Subject to the same api.github.com auth mismatch.
- `closeIssue` and `reopenIssue` both PATCH the same endpoint (`/repos/{owner}/{repo}/issues/{issue_number}`) — `reopenIssue` uses a virtual path key with `actual_path` override.
- `deleteComment` requires the numeric `comment_id` (from `createComment` response `.id`), not the issue number.
