# Best Buy — Internals

## API Architecture
- REST, same-origin on `www.bestbuy.com`. No GraphQL on the read paths exercised here (the SPA does use `gateway/graphql` for cart-page reviews/recommendations, not for our ops).
- `searchProducts` → `/suggest/v1/fragment/suggest/www` typeahead. Returns top ~9 SKUs per term.
- `getProductDetails` → `/suggest/v1/fragment/products/www` companion endpoint to suggest; takes comma-separated `skuids`.
- `getProductPricing` → `/api/3.0/priceBlocks` — canonical pricing with offers, open-box, protection plans.
- `addToCart` → `POST /cart/api/v1/addToCart` with `{ items: [{ skuId }] }`. Response includes `summaryItems[].lineId` (e.g. `5a61wnug5bb3l-4q4q3qg3lmiml`) — server-generated, single-use, opaque.
- `removeFromCart` → `DELETE /cart/item/{lineId}`. **No JSON body.** Response is the full cart order snapshot (`{ order: { id, cartItemCount, lineItems[], orderSkus[], ... } }`), not the slim `{ cartCount, cartSubTotal, summaryItems[] }` that `addToCart` returns.

## Auth
- `cookie_session` (Akamai-managed cookies set automatically when browsing bestbuy.com).
- No user login needed for read ops. Cart write ops work for both anonymous and signed-in carts; the cart is keyed off the Akamai session cookie.
- No CSRF token required on the cart endpoints — Akamai bot scoring is the only gate.

## Transport
- **`page` (browser_fetch)** for everything. Direct HTTP (curl, node fetch) is blocked by Akamai with HTTP/2 protocol errors; `page.evaluate(fetch)` against an open `bestbuy.com` tab passes the bot check.
- Homepage or any product/cart page is sufficient as the open page.

## Extraction
- Direct JSON for all 5 ops. No SSR scraping; no `__NEXT_DATA__`.

## Known Issues
- **Akamai bot protection** — must run through `transport: page`. Direct HTTP is blocked.
- **Spec'd-but-nonexistent cart endpoints return SPA HTML 200, not 404.** A POST to `/cart/api/v1/removeFromCart` (the original speculative spec), `/cart/api/v1/cart/items/delete`, `/cart/api/v1/deleteItems`, `/cart/api/v1/delete`, etc. all respond `200 text/html` with the SPA shell. Easy false-positive: a status-only verifier sees `200` and PASSes a route that does nothing. Always assert `content-type: application/json` AND a body field from the schema. The real cart-mutation router only accepts `DELETE /cart/item/{lineId}` and a few sibling DELETE routes.
- **`addToCart` may return `ITEM_NOT_SELLABLE` (HTTP 400)** for SKUs that are not online-purchasable — observed for AAA batteries `6452872` and similar store-pickup-only items. Sellable test SKU: HDMI cable `6472356`.
- **Compiler incompatible** — `pnpm dev compile` filters out all captured traffic ("No filtered samples after analyzer filtering stage"). Manual fixture creation required.
- **`lineId` is server-generated and single-use.** Verify must chain via `${prev.addToCart.summaryItems.0.lineId}`; the resolver is in `src/lib/template-resolver.ts`.

## Probe Results
- Discovery method (2026-04-19): CDP-driven add via `page.evaluate(fetch('/cart/api/v1/addToCart', ...))` then UI click on the cart-row "Remove" button. Network listener captured the resulting `DELETE /cart/item/{lineId}` call. Direct fetch confirmation showed the same DELETE round-tripping a JSON cart-order snapshot.
- All POST variants of "remove" (matching the original spec path and obvious sibling shapes) returned `200 text/html` SPA shell — not a real route.
