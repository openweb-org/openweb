# Target Reverse Write Op — Summary

## What was added

One reverse write operation to complement addToCart:

| New Op | Reverses | Mechanism | Key Param |
|--------|----------|-----------|-----------|
| removeFromCart | addToCart | DELETE `/web_checkouts/v1/cart_items/{cart_item_id}` | `cart_item_id` |

## Files changed

- **openapi.yaml** — new DELETE path on `/web_checkouts/v1/cart_items/{cart_item_id}` (stable_id tgt0005), uses `requestBody` with `application/json` content type. Permission: write, safety: caution.
- **examples/removeFromCart.example.json** — example with `replay_safety: unsafe_mutation`.
- **manifest.json** — operation_count 3→5, l1_count 3→5 (addToCart was uncounted before).
- **DOC.md** — added "Remove from cart" workflow, ops table row, quick start example, updated API architecture notes and known issues.

## Patterns discovered

1. **Target cart removal is standard REST DELETE**: Unlike Walmart which reuses a GraphQL mutation with `quantity: 0`, Target uses a proper REST DELETE to `/web_checkouts/v1/cart_items/{cart_item_id}`. The `cart_item_id` is returned in the addToCart response.
2. **No adapter needed**: Both addToCart and removeFromCart are direct REST calls to `carts.target.com` — no adapter/page interaction required. Node transport works.
3. **cart_item_id is the key**: The user must obtain the `cart_item_id` from the addToCart response. There is no "remove by tcin" convenience — this matches how the Target frontend works.

## Pitfalls

- **Write ops blocked by permission layer**: The verify command with `--write --browser` correctly blocks write ops with "Permission required: write on target/removeFromCart" unless `config.json` grants write permission. This is expected behavior.
- **manifest stats were stale**: The previous manifest had `operation_count: 3, l1_count: 3` despite addToCart already existing. Updated to 5 total (3 read + 2 write).

## Verification

- `pnpm build` — 96 sites, 907 files
- `pnpm --silent dev verify target --write --browser` — PASS 3/4 ops (3 reads pass, removeFromCart correctly blocked by permission layer)
