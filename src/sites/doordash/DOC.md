# DoorDash — Internals

## API Architecture
- **GraphQL** gateway at `https://www.doordash.com/graphql/<operationName>?operation=<operationName>`
- All requests POST with JSON body `{ operationName, variables, query }`
- Full query strings sent per-request (no persisted query hashes)
- Responses can be large: storepageFeed ~230KB, getConsumerOrdersWithDetails ~86KB
- Compiler cannot auto-compile (all POST with body → auto-skipped) — requires manual L3 declarative spec

## Auth
- **cookie_session** — user must be logged in via managed browser
- Auth cookies: `dd_session_id`, `ddweb_token`
- No CSRF header injection needed (reads and writes work with cookies only)

## Transport
- **page** (browser fetch via `wrap: variables`, `unwrap: data`) — runs `fetch(..., { credentials: 'include' })` from a doordash.com page so cookies are attached automatically
- Any DoorDash page must be open (`doordash.com/*`)

## Extraction
- Direct JSON from GraphQL `data.<rootField>` (declarative `unwrap: data`)
- Search adapter normalizes nested `FacetV2` structure, parses `custom` JSON for `store_id`
- Menu and order data returned as-is from GraphQL

## Known Issues
- `formattedAddress` in order history is often null.
- Search results include non-store items (grocery suggestions) — use `resultType` to filter.
- No bot detection observed for authenticated sessions.
- **`addCartItemInput` is wide.** Upstream `AddCartItemInput` requires `storeId`, `itemId`, `itemName`, `currency`, `unitPrice` (Int! cents), and `menuId` — five of those don't appear in the legacy "client docs" view of the schema but are enforced server-side. Missing any returns `BAD_USER_INPUT` per field. All five are obtainable from `getRestaurantMenu` (item id/name, displayPrice → cents, currency from store, `menuBook.id`).
- **`removeCartItemV2` takes positional args, not a wrapper.** Mutation signature is `removeCartItemV2(cartId: ID!, itemId: ID!)`. The previous `RemoveCartItemInput` wrapper does not exist in the schema (server suggests `MoveCartItemsInput`/`UpdateCartItemInput` as nearest matches). Pre-2026-04-19 spec was wrong; rewriting against the real signature unblocked verify.
- **Empty-cart response is sparse.** When the removed item was the last in the cart, `removeCartItemV2` returns the cart UUID but `subtotal/currencyCode/fulfillmentType/restaurant/orders` are all `null`. Spec marks these `[type, 'null']` so verify doesn't drift.
- **Pair verify uses cross-op templating.** `removeFromCart` example references `${prev.addToCart.addCartItemV2.id}` and `${prev.addToCart.addCartItemV2.orders.0.orderItems.0.id}` so the destroy op acts on a freshly-created cart_item per run. See `doc/todo/write-verify/design/cross-op-templating.md`.

## Probe Results
- 5/5 ops PASS as of 2026-04-19 (`850a7cc`).
- `addToCart` `restaurant.name` and `orderItems[0].{singlePrice,priceDisplayString,item.price}` returned `null` for first-add-to-empty-cart cases — relaxed to `[type, 'null']` to match observed responses without losing the schema for populated carts.
