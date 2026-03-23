# Uber

## Overview
Ride-hailing + food delivery platform. Multi-domain: Uber Rides (riders.uber.com) and Uber Eats (ubereats.com) share auth but have separate API surfaces.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchRestaurants | search Eats restaurants by keyword | POST `ubereats.com/_p/api/getSearchFeedV1` | returns name, rating, image, delivery time, storeUuid |
| getRideHistory | list past rides | POST `riders.uber.com/graphql` (Activities) | returns destination, fare, date, trip UUID, map image |
| getEatsOrderHistory | list past Eats orders | POST `ubereats.com/_p/api/getPastOrdersV1` | returns store, items, prices, timestamps |

## API Architecture
- **Eats**: REST-style POST endpoints at `ubereats.com/_p/api/<operationName>`. Request body is JSON. Response wraps data in `{ status, data }`.
- **Rides**: GraphQL at `riders.uber.com/graphql`. Standard `{ operationName, variables, query }` request body. Response follows `{ data, errors }`.
- **m.uber.com**: Also has GraphQL at `m.uber.com/go/graphql` (same operations as riders.uber.com but used by the ride-booking SPA). Useful for `PudoLocationSearch` (address autocomplete) and `GetStatus` (nearby vehicles, city info).
- Both APIs accept `x-csrf-token: x` (static placeholder, not derived from cookies).

## Auth
- **Type**: cookie_session
- Shared session cookies across uber.com subdomains
- Auth check: look for `sid`, `csid`, or `jwt-session` cookies
- All API calls use `credentials: 'include'` via `page.evaluate(fetch(...))` to carry cookies

## Transport
- **page** — all 3 operations require browser context for cookie auth
- Eats operations: browser must have visited `ubereats.com` (any page)
- Rides operations: browser must have visited `riders.uber.com` (the `/trips` page works well)

## Extraction
- Direct JSON responses from both REST and GraphQL — no SSR extraction needed
- Eats search results are in `data.feedItems[]` with type `REGULAR_STORE`; nested structure requires drilling into `.store.title.text`, `.store.rating.text`, `.store.meta[]` (badgeType-keyed)
- Eats order history uses a map pattern: `data.ordersMap[uuid]` keyed by `data.orderUuids[]`
- Rides history returns flat activity objects with `title` (destination), `description` (fare), `subtitle` (date)

## Known Issues
- **Ride price estimate not captured**: The fare estimation GraphQL operation requires entering pickup + dropoff addresses via the m.uber.com SPA. The SPA uses custom React components (no standard `<input>` attributes — no data-testid, placeholder, or aria-label) making automated interaction difficult. The GraphQL operation name for fare/product estimation was not discovered.
- **Eats search redirect**: Navigating to `ubereats.com/search?q=X` redirects through a `?next=` parameter and adds a `pl=` base64 location payload. The `getSearchFeedV1` API call bypasses this.
- **m.uber.com/go/activity redirects to /go/home**: The activity page on the ride SPA doesn't expose ride history; must use `riders.uber.com/trips` instead.
- **No bot detection observed**: Neither PerimeterX nor DataDome blocked any requests during capture. However, Uber does use Mountain.com (likely an internal analytics/tracking system).
