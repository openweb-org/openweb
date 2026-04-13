# Uber — Internals

## API Architecture
- **Rides**: GraphQL endpoints on `m.uber.com/go/graphql` (location search, fare estimate) and `riders.uber.com/graphql` (ride history)
- Both accept `x-csrf-token: x` (static placeholder)
- Response: standard GraphQL `{ data, errors }` envelope

## Auth
- **Type**: cookie_session
- Shared session cookies across uber.com subdomains (`sid`, `csid`, `jwt-session`)
- Same auth as Uber Eats (ubereats site)

## Transport
- `transport: page` — all operations use page.evaluate(fetch) to call GraphQL APIs (Tier 5)
- m.uber.com for location/fare ops; riders.uber.com for ride history
- Browser context needed for cookie auth + CORS

## Known Issues
- **Ride history schema differs by origin**: riders.uber.com and m.uber.com have different GraphQL schemas. Activities query requires `activities { past(limit, ...) { activities { ... } } }` nesting on riders.uber.com.
- **Fare estimate locale**: `displayName` may appear in non-English if user's Uber locale is set differently (e.g. "优选轿车" instead of "UberX"). Use `fareAmountCents` for programmatic comparison.
- **Ride request not supported**: `requestRide` and `cancelRide` are real-money NEVER-safety operations. Not implemented.
- **m.uber.com UI non-standard**: React components have zero standard HTML attributes (no data-testid, no placeholder, no aria-label). DOM interaction is not viable.
