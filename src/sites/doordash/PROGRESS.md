# DoorDash Fixture — Progress

## 2026-03-23: Initial discovery and fixture creation

**What changed:**
- Created doordash with 3 operations: searchRestaurants, getRestaurantMenu, getOrderHistory
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

**Verification:** All 3 operations PASS — `openweb verify doordash` green. Content-level verified: search returns real restaurants with names/categories/images, menu returns full item lists with prices, order history returns real past orders with items and totals. `pnpm build` exits 0.

## 2026-04-13 — Auth Fix

**Context:** Login session discovery failed when the auth cascade couldn't find valid cookies on certain session states.
**Changes:** Fixed auth cascade in `openapi.yaml` so cookie_session discovery correctly identifies logged-in sessions via `dd_session_id`/`ddweb_token`.
**Verification:** Auth cascade now reliably detects login state; operations that require auth no longer fail on valid sessions.

## 2026-04-19 — Write-op verify investigation

**Context:** First end-to-end `verify --write` sweep across the site catalog. `removeFromCart` failed param validation before any network call ("Unknown parameter(s): orderCartId, orderItemId") — the example was passing the two fields flat at the top level, but the schema declares them nested under a `removeCartItemInput` body property.
**Changes:** `d25786b` wraps the example input under `removeCartItemInput` so param validation passes. DOC.md Known Issues + SKILL.md Known Limitations updated to record that even with the correct shape, live verify still cannot replay the op (cross-op chain limitation).
**Verification:** 0/1 partial — param shape gate now passes, but live replay against placeholder `cart-uuid`/`order-item-id` fails downstream as expected (the live mutation needs a real cart-item-id from a prior `addToCart` call).
**Key discovery:** `removeFromCart` is the canonical example of the cross-op response templating gap — verify treats each example as a closed input, so there is no way to feed a server-generated id from one op's response into a later op's input. Pattern affects 5+ sites (doordash, costco, target, pinterest unsavePin, x several pair-creates). Agents can chain manually; static verify cannot. Resolution requires `${prev.<opId>.<field>}` syntax in `verify.ts` — tracked as architectural ticket in `doc/todo/write-verify/handoff.md` §4.1.
