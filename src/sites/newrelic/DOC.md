# New Relic

## Overview
New Relic GraphQL API — observability platform, dashboard entity search.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| listDashboards | list dashboards via entity search | POST /graphql | fixed GraphQL query, cursor pagination |

## API Architecture
- Single GraphQL endpoint at `one.newrelic.com/graphql`
- **Fixed query** — the GraphQL query string is a constant (`const`), not user-provided
- Query searches for `domain = 'VIZ' AND type = 'DASHBOARD'` entities
- Cursor pagination: response `data.actor.entitySearch.results.nextCursor` → request `variables.cursor`
- Requires first-party headers: `newrelic-requesting-services: platform|nr1-ui` + `x-requested-with: XMLHttpRequest`

## Auth
- `cookie_session` — uses browser session cookies

## Transport
- `node` — direct HTTP
