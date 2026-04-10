# Amazon — removeFromCart reverse op

## What was done
Added `removeFromCart` as the reverse of `addToCart`. The operation navigates to the cart page, locates the item by ASIN in the active cart items, and clicks the Delete button to remove it.

## Approach
- Adapter-based (L3): DOM interaction on `/gp/cart/view.html`
- Finds cart row via `[data-asin][data-itemtype="active"]` matching target ASIN
- Clicks `input[data-action="delete"]` (Amazon's cart delete button)
- Reads updated cart count and subtotal after removal

## Files changed
- `openapi.yaml` — new `/cart/remove` POST path (stable_id: amz_removeFromCart_v1)
- `adapters/amazon.ts` — removeFromCart handler + execute switch case
- `examples/removeFromCart.example.json` — replay_safety: unsafe_mutation
- `DOC.md` — workflow, ops table, quick start, extraction notes

## Pitfalls
- Amazon's cart Delete button selector (`input[data-action="delete"]`) may vary by locale or A/B test — verify against live DOM
- Cart page requires session cookies; without auth the cart will be empty
- After clicking delete, Amazon may show an undo bar briefly — the 3s wait should let the DOM settle

## Verification
- `pnpm build`: 96 sites, 904 files
- `pnpm dev verify amazon --write --browser`: 6/8 read ops pass; 2 write ops correctly gated behind write permission
