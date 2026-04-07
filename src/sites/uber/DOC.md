# Uber

## Overview
Ride-hailing + food delivery platform. Uber Eats (ubereats.com) REST API for restaurant search and order history with cookie_session auth via node transport.

## Workflows

### Search restaurants
1. `searchRestaurants(userQuery)` → restaurant list with `storeUuid`, name, rating, delivery time

### Review past orders
1. `getEatsOrderHistory()` → orders with store, items, prices, timestamps
2. `getEatsOrderHistory(lastWorkflowUUID=nextCursor)` → next page

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchRestaurants | search Eats restaurants by keyword | userQuery | storeUuid, name, rating, deliveryTime, deliveryFee | entry point |
| getEatsOrderHistory | list past Eats orders | lastWorkflowUUID (pagination) | uuid, storeName, totalPrice, items, completedAt, hasMore, nextCursor | entry point; paginated |

## Quick Start

```bash
# Search Uber Eats restaurants
openweb uber exec searchRestaurants '{"userQuery":"pizza"}'

# Get past Eats orders (first page)
openweb uber exec getEatsOrderHistory '{}'

# Get next page of orders (use nextCursor from previous response)
openweb uber exec getEatsOrderHistory '{"lastWorkflowUUID":"<nextCursor>"}'
```

---

## Site Internals

## API Architecture
- **Eats**: REST-style POST endpoints at `ubereats.com/_p/api/<operationName>`. Request body is JSON. Response wraps data in `{ status, data }`.
- Both APIs accept `x-csrf-token: x` (static placeholder, not derived from cookies).

## Auth
- **Type**: cookie_session
- Shared session cookies across uber.com subdomains
- Auth check: look for `sid`, `csid`, or `jwt-session` cookies

## Transport
- `transport: node` — all operations use server-side HTTP with cookie_session auth
- No browser required; cookies sourced from 4-tier cache cascade

## Known Issues
- **Ride history not available**: The `getRideHistory` operation was in the original capture plan but is not implemented in the adapter — only Eats operations are supported currently.
- **Ride price estimate not captured**: The fare estimation GraphQL operation requires entering pickup + dropoff addresses via the m.uber.com SPA with custom React components (no standard attributes), making automated interaction difficult.
- **Eats search redirect**: Navigating to `ubereats.com/search?q=X` redirects through a `?next=` parameter. The `getSearchFeedV1` API call bypasses this.
- **No bot detection observed**: Neither PerimeterX nor DataDome blocked requests during capture.
