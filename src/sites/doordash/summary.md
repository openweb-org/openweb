# DoorDash — removeFromCart Summary

## What was added
- `removeFromCart` reverse write op for `addToCart`
- Uses DoorDash's `removeCartItemV2` GraphQL mutation at `/graphql/removeCartItem`
- Input: `orderCartId` (cart UUID) + `orderItemId` (specific item to remove)
- Returns updated cart with remaining items, subtotal, restaurant info

## Approach
- Followed the existing `addToCart` pattern: inline GraphQL mutation in openapi.yaml with `wrap: variables`
- No adapter needed — DoorDash ops are spec-only with embedded query strings
- Response schema mirrors addToCart (same cart shape with `orders[].orderItems[]`)

## Key decisions
- Used `removeCartItemV2` mutation name (matches `addCartItemV2` naming convention)
- Input uses `RemoveCartItemInput` with `orderCartId` + `orderItemId` (not storeId/itemId — removal needs cart-scoped identifiers)
- Set `safety: caution` and `permission: write` per convention

## Pitfalls
- `orderCartId` and `orderItemId` are ephemeral — only available from a prior `addToCart` response in the same session
- No way to list cart contents independently (no getCart op) — must chain from addToCart
- Site was quarantined during verify due to no active browser session — read ops also failed, not just writes

## Verification
- `pnpm build`: 96 sites, 907 files — clean
- `pnpm dev verify doordash --write --browser`: removeFromCart correctly blocked by permission layer (expected for write ops)
