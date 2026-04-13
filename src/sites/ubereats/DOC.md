# Uber Eats — Internals

## API Architecture
- **Eats**: REST-style POST endpoints at `ubereats.com/_p/api/<operationName>`. Request body is JSON. Response wraps data in `{ status, data }`.
- All APIs accept `x-csrf-token: x` (static placeholder, not derived from cookies).
- **Cart APIs**: Server-side draft orders.
  - `createDraftOrderV2` — add items to cart (creates draft order with shopping cart items)
  - `removeItemsFromDraftOrderV2` — remove specific items by shoppingCartItemUUID (keeps other items)
  - `discardDraftOrdersV1` — discard entire draft order for a store (emptyCart)
  - `getDraftOrdersByEaterUuidV1` — read all draft orders with full item details (getCart)
  - `getCartsViewForEaterUuidV1` — cart summaries with store names and subtotals
- **Customizations**: Items with `hasCustomizations` flag have required options. `getMenuItemV1` returns `customizationsList` with groups (uuid, title, minPermitted, maxPermitted) and options (uuid, title, price). Pass as `{groupUuid: [{uuid: optionUuid, quantity: 1}]}`.
- **Menu data**: `getStoreV1` returns full menu via `catalogSectionsMap` → `standardItemsPayload` → `catalogItems`. Each item has `uuid`, `title`, `price` (cents), `imageUrl`, `hasCustomizations`.

## Auth
- **Type**: cookie_session
- Shared session cookies across uber.com subdomains (`sid`, `csid`, `jwt-session`)

## Transport
- `transport: node` — read operations (search, menu, order history) use server-side HTTP
- `transport: page` — cart operations use `page.evaluate(fetch)` to call draft order APIs (Tier 5). No DOM selectors.
- All `_p/api` endpoints work reliably from node transport with session cookies despite DataDome presence.

## Known Issues
- **DataDome observed**: Bot detection scripts present but `_p/api` endpoints work reliably from node.
- **Items with customizations**: McNuggets and similar items now require sauce/side selection. Use `getMenuItemV1` to discover required groups. Without selections, the item may not appear correctly at checkout.
- **Store UUID format**: Search results return full UUID (e.g. `8b2f2683-...`). URL slugs use base64url encoding of UUID bytes.
- **Fare estimate locale**: Cart item prices are in cents (integer). Display formatting depends on `currencyCode`.
