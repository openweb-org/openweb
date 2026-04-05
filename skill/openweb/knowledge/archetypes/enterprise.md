# Enterprise, Developer Tools & Finance

> Archetypes are heuristic starting points, not limiting checklists.

Business tools, developer platforms, financial services, and productivity apps.

- **Productivity / Enterprise** — dashboards, documents, project management: Stripe, Linear, Asana, Zendesk, YNAB, Webflow, MongoDB Atlas, Amplitude
- **Developer Tools** — repos, issues, packages, monitoring: GitHub, Docker Hub, Grafana, PostHog, CockroachDB, CircleCI, GitLab
- **Finance / Banking** — trading, portfolio, market data: Fidelity, Robinhood, Bloomberg, Yahoo Finance
- **Email** — inbox, messages, compose: Gmail, Outlook
- **Cloud / Storage** — files, folders, sharing: Dropbox, OneDrive, Box

## Expected Operations

**Productivity / Enterprise:** List documents/items (read, paginated), document/item detail (read), create (write), update (write), search (read), dashboard/overview (read)

**Developer Tools:** List repos/projects (read, paginated), repo detail (read), list issues (read, paginated), create issue (write), search (read), user/org profile (read)

**Finance / Banking:** Account/portfolio overview (read), stock/asset quote (read, by symbol), market data (read), transaction history (read, paginated), search securities (read), place order (transact -- deny by default)

**Email & Cloud / Storage:** List inbox/files (read, paginated), read message/file metadata (read), send message/upload file (write), search (read)

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

**Developer Tools:**
- [ ] Pagination type documented (link_header, cursor, offset)
- [ ] Public vs authenticated endpoints distinguished
- [ ] Rate limits documented (GitHub: 60/h unauth, 5000/h auth)

**Finance / Banking:**
- [ ] Read-only market data separated from account operations
- [ ] Order/trade operations gated with `transact` permission
- [ ] Session tokens documented (short expiry common)
- [ ] Sensitive data (account numbers, SSN) excluded from responses
- [ ] Real-time quote data vs delayed data noted
