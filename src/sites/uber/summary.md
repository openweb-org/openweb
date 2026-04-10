# Uber — removeFromCart reverse op

## What was done
Added `removeFromCart` as the reverse of `addToCart`. The operation opens the cart UI, locates the item, and clicks the remove/delete button.

## Approach
- Adapter-based (L3): DOM interaction on ubereats.com cart
- Navigates to UberEats home, clicks cart button to open cart panel
- Finds remove button via data-testid selectors, with fallback to aria-label
- Reads updated cart count badge after removal

## Files changed
- `openapi.yaml` — new `/internal/removeFromCart` POST path (stable_id: ub0005)
- `adapters/uber-eats.ts` — removeFromCart handler + OPERATIONS map entry
- `examples/removeFromCart.example.json` — replay_safety: unsafe_mutation
- `manifest.json` — operation_count 4→5
- `DOC.md` — workflow, ops table, quick start, known issues

## Pitfalls
- UberEats cart is client-side (localStorage) — no server API for removal
- Cart UI data-testid selectors may change across UberEats deployments/A/B tests
- Must have items in cart for remove to work — empty cart triggers retriable error
- Same React event handling challenges as addToCart

## Verification
- `pnpm build`: 96 sites, 908 files
- `pnpm dev verify uber --write --browser`: 3/5 read ops pass; 2 write ops correctly gated behind write permission
