# Best Buy — removeFromCart Summary

## What was done
Added `removeFromCart` as the reverse write op of `addToCart` to the bestbuy site package.

## Approach
- Best Buy's cart API follows a REST convention under `/cart/api/v1/` — `addToCart` POSTs items by `skuId`, and `removeFromCart` POSTs items by `lineId`
- The `lineId` is returned in the `addToCart` response `summaryItems` array, linking add → remove
- No adapter needed: the endpoint is a standard REST POST, handled by the existing `page` transport (browser_fetch through Akamai)

## Key decisions
- **Input key is `lineId`, not `skuId`**: Best Buy's cart removal requires the cart-line identifier, not the product SKU. This matches how the cart API distinguishes multiple instances of the same product
- **Response schema mirrors addToCart**: returns `cartCount`, `cartSubTotal`, and remaining `summaryItems`
- **stable_id bb0005**: follows sequential numbering from bb0004 (addToCart)

## Verification
- `pnpm build`: 96 sites, 907 files — clean
- `pnpm dev verify bestbuy --write --browser`: 3/4 ops pass (searchProducts, getProductDetails, getProductPricing). removeFromCart correctly blocked by permission layer — expected for write ops without explicit config grants

## Pitfalls
- `lineId` is ephemeral — only valid for the current cart session. Cannot be hardcoded or cached across sessions
- Akamai bot protection requires page transport; direct HTTP calls will fail
- The example uses a placeholder `lineId` and is marked `replay_safety: unsafe_mutation`
