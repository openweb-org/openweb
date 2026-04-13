# Uber Rides — Progress

## 2026-04-13: Initial build — searchLocations, getRideEstimate, getRideHistory

**Context:** Split from combined uber/ubereats site. Rides operations needed separate site due to different domains (m.uber.com, riders.uber.com) and API style (GraphQL vs REST).

**Changes:**
- Created `uber` site with 3 operations
- `searchLocations`: PudoLocationSearch GraphQL on m.uber.com/go/graphql
- `getRideEstimate`: Products GraphQL on m.uber.com/go/graphql — returns fare quotes for all vehicle types
- `getRideHistory`: Activities GraphQL on riders.uber.com/graphql — nested query structure (`activities.past.activities`)

**Key discoveries:**
- m.uber.com and riders.uber.com have different GraphQL schemas (same field names, different argument patterns)
- Products query requires `InputCoordinate!` (non-null) for pickup, `[InputCoordinate!]!` (array) for destinations
- Error-message reversal partially works — server returns "something went wrong" for non-existent fields but "Invalid GraphQL query" for object fields without sub-selections
- `displayName` returns in user's locale setting (e.g. "优选轿车" for UberX in Chinese)
- URL-based navigation (`/go/product-selection?drop[0]=...`) triggers Products query automatically

**Verification:** Pending.
