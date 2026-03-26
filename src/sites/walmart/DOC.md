# Walmart

## Overview
E-commerce. Walmart.com — product search, detail pages, pricing, and cart operations. Read ops use Next.js SSR extraction; write ops use an adapter with persisted GraphQL mutations via browser context.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchProducts | search by keyword | GET /search?q={q} | returns itemStacks with name, price, rating, itemId |
| getProductDetail | product detail page | GET /ip/{slug}/{itemId} | full product: name, brand, description, images, pricing, reviews count |
| getProductPricing | product pricing | GET /ip/{itemId} | focused: currentPrice, wasPrice, savingsAmount, isPriceReduced |
| addToCart | ⚠️ add product to cart | POST /internal/addToCart | adapter-based; accepts usItemId + quantity, calls updateItems GraphQL mutation |

## API Architecture
- **Read ops (SSR-only)** — no public REST/GraphQL endpoints accessible without auth headers
- Internal APIs (`/orchestra/*/graphql`) return 418 to direct requests
- Affiliate API (`developer.api.walmart.com`) requires security headers (API key)
- All useful read data is embedded in `__NEXT_DATA__` within the SSR HTML
- **Write ops (adapter)** — use persisted GraphQL mutations from browser context
  - `MergeAndGetCart` → get/create cart via `/orchestra/cartxo/graphql`
  - `updateItems` → add/update items via `/orchestra/home/graphql`
  - Adapter fetches product offerId from SSR data, then calls mutations
- Search and PDP pages have different pricing schemas:
  - Search: flat — `priceInfo.linePrice` (string like "$159.00"), `priceInfo.wasPrice`, `priceInfo.savings`
  - PDP: nested — `priceInfo.currentPrice.price` (number), `priceInfo.wasPrice.price`

## Auth
- No auth needed for public product data (read ops)
- Cart works for both guest and logged-in users
- `requires_auth: false`

## Transport
- Read ops: `transport: node` — direct HTTP fetch from Node.js, SSR extraction
- Write ops: `transport: page` — browser-based adapter, requires walmart.com page open in CDP browser

## Extraction
- Read ops: `ssr_next_data` on all 3 read operations
  - Search: `props.pageProps.initialData.searchResult`
  - Product detail: `props.pageProps.initialData.data.product`
  - Pricing: `props.pageProps.initialData.data.product.priceInfo`
- Write ops: adapter handles extraction internally
  - Product offerId from SSR `__NEXT_DATA__` via in-page fetch
  - Cart data from GraphQL response

## Known Issues
- **PerimeterX bot detection** blocks all CDP-connected browsers for full page navigations (headless and non-headless). Navigating to any walmart.com URL in the managed browser redirects to `/blocked?url=...` ("Robot or human?" challenge). Initial page load typically succeeds; subsequent full navigations are blocked. SPA navigation and in-page fetch() calls work.
- **addToCart requires open walmart.com page** — the adapter needs a browser tab on walmart.com. Open one manually before using addToCart.
- **Persisted query hashes** — the GraphQL mutation hashes are derived from query text and are stable across Walmart deploys, but could change if Walmart modifies the query schema.
- **Search results cause persistent verify DRIFT** — different products returned each call, with varying field structures. Schema validation passes; only the fingerprint hash changes. Expected behavior for dynamic endpoints.
- **`averageRating` nullable** — some search result items have `null` rating. Schema uses `type: [number, "null"]`.
- **URL redirects** — `/ip/{itemId}` (short form) redirects to canonical `/ip/{slug}/{itemId}`. Both work; `fetchWithRedirects` handles this transparently.
