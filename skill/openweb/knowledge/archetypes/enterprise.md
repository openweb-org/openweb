# Enterprise, Developer Tools & Finance

> Archetypes are heuristic starting points, not limiting checklists.

Business tools, developer platforms, financial services, and productivity apps.

- **Productivity / Enterprise** — dashboards, documents, project management: Stripe, Linear, Asana, Zendesk, YNAB, Webflow, MongoDB Atlas, Amplitude
- **Developer Tools** — repos, issues, packages, monitoring: GitHub, Docker Hub, Grafana, PostHog, CockroachDB, CircleCI, GitLab
- **Finance / Banking** — trading, portfolio, market data: Fidelity, Robinhood, Bloomberg, Yahoo Finance
- **Email** — inbox, messages, compose: Gmail, Outlook
- **Cloud / Storage** — files, folders, sharing: Dropbox, OneDrive, Box

## Expected Operations

**Productivity / Enterprise:**
- Read: list documents/items (paginated), document/item detail, search, dashboard/overview, notifications, activity feed
- Write (reversible pairs):
  - createItem / deleteItem (or archiveItem / unarchiveItem)
  - updateItem (reversible via re-update)
  - completeTask / uncompleteTask
  - assignItem / unassignItem
- Write (one-way): moveItem, addLabel, removeLabel

**Developer Tools:**
- Read: list repos/projects (paginated), repo detail, list issues (paginated), search, user/org profile, notifications, activity feed
- Write (reversible pairs):
  - starRepo / unstarRepo
  - createIssue / closeIssue (or reopenIssue)
  - createComment / deleteComment
  - watchRepo / unwatchRepo
- Write (one-way): forkRepo (creates new repo, no undo needed)

**Finance / Banking:**
- Read: account/portfolio overview, stock/asset quote (by symbol), market data, transaction history (paginated), search securities
- Write (reversible pairs):
  - addToWatchlist / removeFromWatchlist
- Transact (deny by default): placeOrder, transfer

**Email & Cloud / Storage:**
- Read: list inbox/files (paginated), read message/file metadata, search
- Write (reversible pairs):
  - starMessage / unstarMessage
  - moveToFolder / moveBack
  - archiveMessage / unarchiveMessage
- Write (one-way): sendMessage (email), uploadFile, deleteFile

## Typical Profile

| Aspect | Productivity | Dev Tools | Finance | Email | Cloud |
|--------|-------------|-----------|---------|-------|-------|
| Auth | cookie_session, sessionStorage_msal | cookie_session, none | cookie_session, exchange_chain | oauth2, sessionStorage_msal | bearer_token, sessionStorage_msal |
| Transport | node | node | node or page | node | node |
| GraphQL | common (Linear, New Relic, Amplitude) | rare | moderate | rare | rare |
| CSRF | meta_tag or cookie_to_header | meta_tag | varies | n/a | n/a |

## Notable Patterns

- **Stripe:** page_global auth (PRELOADED object). Heavy compile noise (~80 internal ops per ~20 useful).
- **Linear:** GraphQL at client-api.linear.app. SPA renders login without redirect.
- **Twilio:** fetches credentials from API -> HTTP Basic Auth.
- **YNAB:** dual API (Catalog RPC + REST), server_knowledge sync for writes.
- **CockroachDB:** gRPC-Web with binary protobuf encoding.
- **GitHub:** link_header pagination, meta_tag CSRF, also has unauthenticated public API.
- **Finance sites:** real-money operations require strict `transact` gating.

## Curation Checklist

**Productivity / Enterprise:**
- [ ] Dashboard/list operations return structured data (not rendered HTML)
- [ ] GraphQL operations have correct operationName and variables
- [ ] CSRF token source identified and configured
- [ ] Context IDs (org, team, project) documented in DOC.md
- [ ] Write ops gated with `write` permission
- [ ] create/delete and complete/uncomplete pairs both work

**Developer Tools:**
- [ ] Pagination type documented (link_header, cursor, offset)
- [ ] Public vs authenticated endpoints distinguished
- [ ] Rate limits documented (GitHub: 60/h unauth, 5000/h auth)
- [ ] star/unstar pair both work
- [ ] createIssue/closeIssue pair both work

**Finance / Banking:**
- [ ] Read-only market data separated from account operations
- [ ] Order/trade operations gated with `transact` permission
- [ ] addToWatchlist / removeFromWatchlist pair both work
- [ ] Session tokens documented (short expiry common)
- [ ] Sensitive data (account numbers, SSN) excluded from responses
- [ ] Real-time quote data vs delayed data noted
