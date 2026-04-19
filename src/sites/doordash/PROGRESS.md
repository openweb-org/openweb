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

## 2026-04-19 — Write-Op Verify Campaign (2/2 PASS)

**Context:** After cross-op templating landed (`9b495b3` resolver, `7be28ad` verify wire), unblocked the addToCart→removeFromCart chain. Discovered the existing spec was wrong in two ways once a real request actually went out.

**Changes (`850a7cc`):**
- Added `addToCart.example.json` with all six server-required fields. Response chained into removeFromCart via `${prev.addToCart.addCartItemV2.id}` and `…orders.0.orderItems.0.id`.
- Widened `addCartItemInput` schema: `itemName`, `currency`, `unitPrice` (Int! cents), `menuId` are upstream-required (not just `storeId`/`itemId` as the legacy spec claimed).
- Rewrote `removeCartItemV2` mutation: real signature is `(cartId: ID!, itemId: ID!)` — no `RemoveCartItemInput` wrapper exists in the schema. Replaced query const + body schema accordingly.
- Marked nullable fields on responses where upstream returns `null`: `restaurant.name`, `orderItems[].{singlePrice,priceDisplayString}`, `item.price` (newly-added items), and `removeCartItemV2.{subtotal,currencyCode,fulfillmentType,restaurant,orders}` (cart now empty).

**Verification:** `pnpm dev verify doordash --write --browser` → 5/5 PASS (3 reads + addToCart + removeFromCart). Pair runs against the live cart on each invocation; no fixture decay.

**Key discoveries:**
- Spec drift hidden by permission gates. The previous "0/1 partial" status only verified param shape — the live mutation was never replayed, so the wrong field name (`removeCartItemInput` wrapper) and the missing `addCartItemInput` fields went undetected for a year.
- GraphQL "Did you mean…" hints in `extensions.code = GRAPHQL_VALIDATION_FAILED` are the fastest way to discover real schema drift — server suggested `MoveCartItemsInput`/`UpdateCartItemInput` when we sent `RemoveCartItemInput`.
- Empty-cart response is sparse: spec must mark cart-summary fields `[type, 'null']` or removeFromCart drifts the moment the test cart hits zero items.

**Pitfalls:**
- `~/.openweb/sites/doordash` is a *copy* of `src/sites/doordash` (not a symlink), populated by `registry install` or first-load. Edits to `src/` aren't seen by verify until that copy is refreshed (or symlinked) — multi-worker contention also re-creates the dir mid-session. Symlinking `~/.openweb/sites/doordash → src/sites/doordash` is the fastest dev loop while iterating on a spec.
- Ran behind several sibling `w-fix-*` workers also touching managed Chrome — port 9222 PID flips frequently. Verify failure mode "Port 9222 is already bound by external process" is a coordination artifact, not a site bug; restart the browser and retry.

