# DoorDash Fixture — Progress

## 2026-03-23: Initial discovery and fixture creation

**What changed:**
- Created doordash-fixture with 3 operations: searchRestaurants, getRestaurantMenu, getOrderHistory
- Built L3 adapter (`doordash-graphql.ts`) — constructs simplified GraphQL queries, executes via browser fetch
- Added test cases for all 3 operations
- Updated `doc/knowledge/archetypes.md` with "Food Delivery / Marketplace" archetype

**Why:**
- DoorDash uses a GraphQL gateway for all data — standard compiler skips POST mutations with bodies
- L3 adapter needed to construct GraphQL bodies and normalize nested response structures (FacetV2 for search)
- Simplified queries (vs full 22KB production queries) work because DoorDash doesn't use persisted query hashes

**Discovery notes:**
- Capture tool had issues: CDP capture mixed traffic from other tabs; state snapshots were stale from prior session
- Used direct CDP interception (`page.on("response")`) for reliable GraphQL traffic capture
- Auth check initially failed — cookies are `dd_session_id`/`ddweb_token`, not the expected `ddsid`/`dd_session`
- Search response has nested FacetV2 structure with `custom` field as JSON string containing `store_id`

**Verification:** All 3 operations PASS — `openweb verify doordash-fixture` green. Content-level verified: search returns real restaurants with names/categories/images, menu returns full item lists with prices, order history returns real past orders with items and totals. `pnpm build` exits 0.
