# Walmart Reverse Write Op — Summary

## What was added

One reverse write operation to complement addToCart:

| New Op | Reverses | Mechanism | Key Param |
|--------|----------|-----------|-----------|
| removeFromCart | addToCart | `updateItems` mutation with `quantity: 0` | `usItemId` |

## Files changed

- **openapi.yaml** — new `/internal/removeFromCart` POST path (stable_id wm0006), uses `requestBody` with `application/json` content type. Permission: write, safety: caution.
- **adapters/walmart-cart.ts** — `removeFromCart` handler that gets cart via MergeAndGetCart then calls updateItems with quantity 0. Updated adapter description and execute switch.
- **examples/removeFromCart.example.json** — example with `replay_safety: unsafe_mutation`.
- **manifest.json** — operation_count 3→5, l3_count 0→2 (addToCart was uncounted before).
- **DOC.md** — added "Remove from cart" workflow, ops table row, quick start example, updated API architecture notes and known issues.

## Patterns discovered

1. **Walmart cart removal uses same mutation as add**: The `updateItems` persisted GraphQL mutation handles both add and remove. Setting `quantity: 0` removes the item. No separate "removeItems" mutation needed.
2. **removeFromCart doesn't need offerId**: Unlike addToCart which must fetch the product page to get `offerId`, removeFromCart only needs `usItemId` and the cartId — the cart already knows the item's offerId.
3. **requestBody vs query params**: The openapi.yaml for removeFromCart uses `requestBody` (as requested) rather than query parameters like addToCart. Both work because the adapter receives all params uniformly.

## Pitfalls

- **Write ops blocked by permission layer**: The verify command with `--write --browser` correctly blocks write ops with "Permission required: write on walmart/removeFromCart" unless `config.json` grants write permission. This is expected behavior, matching discord/medium/weibo.
- **manifest stats were stale**: The previous manifest had `operation_count: 3, l3_count: 0` despite addToCart already existing as an L3 adapter op. Updated to 5 total (3 L1 read + 2 L3 write).
- **PerimeterX still blocks full navigations**: removeFromCart doesn't need to navigate (only uses in-page fetch), so PerimeterX doesn't interfere — but a walmart.com page must already be open in the CDP browser.

## Verification

- `pnpm build` — 96 sites, 904 files
- `pnpm --silent dev verify walmart --write --browser` — PASS 3/3 read ops, removeFromCart correctly blocked by permission layer
