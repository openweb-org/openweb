# Uber Fixture — Progress

## 2026-03-23: Initial discovery — Eats search, ride history, Eats orders

**What changed:**
- Discovered Uber's dual API architecture: Eats REST (`_p/api/*`) + Rides GraphQL (`riders.uber.com/graphql`)
- Built L3 adapter (`uber-api.ts`) handling both API surfaces via `page.evaluate(fetch(...))`
- Created 3 operations: `searchRestaurants`, `getRideHistory`, `getEatsOrderHistory`
- Captured API traffic via scripted Playwright CDP recording (multiple passes: initial capture, rides-focused, fare-estimate attempts)
- Added "Multi-Domain Platform" archetype to `knowledge/archetypes.md`

**Why:**
- Target intents: get ride price estimate, get ride history, search restaurants (Eats)
- Achieved 2 of 3 targets; ride price estimate blocked by non-standard React UI components on m.uber.com

**Key discoveries during capture:**
- `m.uber.com/go/graphql` and `riders.uber.com/graphql` share the same GraphQL schema but serve different page contexts
- Eats REST uses `_p/api/<operationName>` convention with POST + JSON body; CSRF is static `x-csrf-token: x`
- Ride history not on `m.uber.com/go/activity` (redirects to home); must use `riders.uber.com/trips` which calls `Activities` GraphQL query
- Eats order history uses map pattern (`ordersMap` keyed by `orderUuids` array) rather than flat array
- Fare estimation requires deep UI interaction — m.uber.com inputs have zero standard HTML attributes (no data-testid, no placeholder, no aria-label)

**Verification:** All 3 operations verified via manual Playwright script — searchRestaurants returned 71 results for "pizza", getRideHistory returned 5 past rides with fares, getEatsOrderHistory returned 10 orders with items and prices.
**Commit:** d153423
