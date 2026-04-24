# Walmart

## Overview
E-commerce. Walmart.com — product search, detail pages, pricing, and cart operations. Read ops use Next.js SSR extraction; write ops use an adapter with persisted GraphQL mutations via browser context.

## Workflows

### Search and view product
1. `searchProducts(q)` → browse results → `usItemId`
2. `getProductDetail(slug, itemId)` → full product info (name, brand, price, reviews, images)

### Compare pricing
1. `searchProducts(q)` → find products → `usItemId`
2. `getProductPricing(itemId)` → currentPrice, wasPrice, savingsAmount, isPriceReduced

### Search and add to cart
1. `searchProducts(q)` → browse results → `usItemId`
2. `addToCart(usItemId, quantity)` → cartId, cartCount, item details

### Remove from cart
1. `removeFromCart(usItemId)` → cartId, cartCount, removedItemId

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search products by keyword | q | name, usItemId, linePrice, averageRating | entry point; returns itemStacks |
| getProductDetail | full product page | slug, itemId ← searchProducts | name, brand, priceInfo, averageRating, numberOfReviews, imageInfo | slug can be any string |
| getProductPricing | focused pricing info | itemId ← searchProducts | currentPrice, wasPrice, savingsAmount, isPriceReduced | subset of product detail |
| addToCart | add product to cart | usItemId ← searchProducts, quantity | cartId, cartCount, item | ⚠️ write op, adapter-based |
| removeFromCart | remove product from cart | usItemId ← addToCart | cartId, cartCount, removedItemId | ⚠️ write op, reverses addToCart |

## Quick Start

```bash
# Search for products
openweb walmart exec searchProducts '{"q": "laptop"}'

# Get full product detail (slug can be any non-empty string)
openweb walmart exec getProductDetail '{"slug": "item", "itemId": "5113175776"}'

# Get focused pricing
openweb walmart exec getProductPricing '{"itemId": "5113175776"}'

# Add to cart (requires browser page on walmart.com)
openweb walmart exec addToCart '{"usItemId": "5113175776", "quantity": 1}'

# Remove from cart (requires browser page on walmart.com)
openweb walmart exec removeFromCart '{"usItemId": "5113175776"}'
```

---

## Site Internals

## API Architecture
- **Read ops (adapter)** — `walmart-read` adapter fetches HTML via in-page `fetch()`, parses `__NEXT_DATA__`, returns trimmed fields. Avoids both PerimeterX CDP blocks and oversized raw SSR responses.
- Internal APIs (`/orchestra/*/graphql`) return 418 to direct requests
- Affiliate API (`developer.api.walmart.com`) requires security headers (API key)
- All useful read data is embedded in `__NEXT_DATA__` within the SSR HTML
- **Write ops (adapter)** — use persisted GraphQL mutations from browser context
  - `MergeAndGetCart` → get/create cart via `/orchestra/cartxo/graphql`
  - `updateItems` → add/update/remove items via `/orchestra/home/graphql`
  - Adapter fetches product offerId from SSR data for addToCart, then calls mutations
  - removeFromCart sets quantity to 0 via the same `updateItems` mutation
- Search and PDP pages have different pricing schemas:
  - Search: flat — `priceInfo.linePrice` (string like "$159.00"), `priceInfo.wasPrice`, `priceInfo.savings`
  - PDP: nested — `priceInfo.currentPrice.price` (number), `priceInfo.wasPrice.price`

## Auth
- No auth needed for public product data (read ops)
- Cart works for both guest and logged-in users
- `requires_auth: false`

## Transport
- Read ops: `transport: page` — adapter does in-page `fetch()` from warm walmart.com page, parses `__NEXT_DATA__` from HTML response
- Write ops: `transport: page` — browser-based adapter, requires walmart.com page open in CDP browser

## Extraction
- Read ops: adapter-based — `walmart-read` adapter fetches HTML, parses `__NEXT_DATA__`, trims to essential fields
  - Search: ~20 items with usItemId, name, brand, prices, rating, thumbnail
  - Product detail: name, brand, description (500 chars), priceInfo, imageInfo (5 images), availability, seller
  - Pricing: currentPrice, wasPrice, unitPrice, savingsAmount, isPriceReduced
- Write ops: adapter handles extraction internally
  - Product offerId from SSR `__NEXT_DATA__` via in-page fetch
  - Cart data from GraphQL response

## Adapter Patterns
- **Orchestra SPA-fingerprint headers** — `/orchestra/home/graphql/*` calls require Walmart's full WebPlayer header bundle; without them Akamai's bot-mitigation layer flags the request as scripted and returns 429 on the first hit. The mitigation cookie/IP isn't throttled — the request *shape* is. The adapter mirrors what the live React app sends:
  - Identity: `x-o-bu: WALMART-US`, `x-o-mart: B2C`, `x-o-platform: rweb`, `x-o-platform-version: usweb-1.256.1`, `x-o-segment: oaoh`, `x-o-ccm: server`, `tenant-id: elh9ie`, `wm_mp: true`
  - Per-call trace: `wm_qos.correlation_id`, `x-o-correlation-id`, `wm-client-traceid`, `traceparent: 00-<32hex>-<16hex>-00`, `x-latency-trace: 1`, `wm_page_url`
  - Apollo envelope: `x-apollo-operation-name`, `x-o-gql-query` (`mutation`/`query` form correctly)
  Apply on every orchestra call (`getCart`, `updateItems`).
- **Cart read via GET `getCart`, not `MergeAndGetCart`** — the SPA itself reads cart state via the lightweight GET `getCart` persisted query when the user is on `/cart`. The earlier implementation called `MergeAndGetCart` (a heavy mutation) twice per op and tripped 429 reliably. Mirroring the SPA's GET pattern brought the failure rate to zero.
- **Idempotent removeFromCart via updateItems(qty=1) seeding** — the `updateItems` mutation accepts `quantity: 0` to remove an item, but Walmart's gateway 400s when the item is not already in the cart. The adapter therefore calls `updateItems(quantity=1)` first to seed the line, then `updateItems(quantity=0)` to remove it. This makes removeFromCart safe to call with any `usItemId` without a preceding addToCart, which matters for verify pair execution and for retries after partial failures.

## Known Issues
- **PerimeterX bot detection** blocks all CDP-connected browsers for full page navigations (headless and non-headless). Navigating to any walmart.com URL in the managed browser redirects to `/blocked?url=...` ("Robot or human?" challenge). Initial page load typically succeeds; subsequent full navigations are blocked. SPA navigation and in-page fetch() calls work.
- **No per-account cart quota** — earlier handoffs classified `removeFromCart` 429s as a per-account quota. **This was a misclassification.** Root cause was missing SPA-fingerprint headers (see Adapter Patterns above); once the full bundle was sent, addToCart and removeFromCart both pass cleanly. There is no observed per-account throttle on cart writes.
- **searchProducts uses `transport: page`** — node SSR fetch was prone to a `Target page, context or browser has been closed` flake on the first request after auth swap. Switching to `transport: page` made it reliable.
- **addToCart/removeFromCart require open walmart.com page** — the adapter needs a browser tab on walmart.com so the SPA's bot-mitigation cookies are warm and Origin/Referer match.
- **Persisted query hashes** — the GraphQL mutation hashes are derived from query text and are stable across Walmart deploys, but could change if Walmart modifies the query schema.
- **Search results cause persistent verify DRIFT** — different products returned each call, with varying field structures. Schema validation passes; only the fingerprint hash changes. Expected behavior for dynamic endpoints.
- **`averageRating` nullable** — some search result items have `null` rating. Schema uses `type: [number, "null"]`.
- **URL redirects** — `/ip/{itemId}` (short form) redirects to canonical `/ip/{slug}/{itemId}`. Both work; `fetchWithRedirects` handles this transparently.
