# Walmart

## Overview
E-commerce. Walmart.com — product search, detail pages, and pricing via Next.js SSR extraction.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchProducts | search by keyword | GET /search?q={q} | returns itemStacks with name, price, rating, itemId |
| getProductDetail | product detail page | GET /ip/{slug}/{itemId} | full product: name, brand, description, images, pricing, reviews count |
| getProductPricing | product pricing | GET /ip/{itemId} | focused: currentPrice, wasPrice, savingsAmount, isPriceReduced |

## API Architecture
- **SSR-only** — no public REST/GraphQL endpoints accessible without auth headers
- Internal APIs (`/orchestra/*/graphql`) return 418 to direct requests
- Affiliate API (`developer.api.walmart.com`) requires security headers (API key)
- All useful data is embedded in `__NEXT_DATA__` within the SSR HTML
- Search and PDP pages have different pricing schemas:
  - Search: flat — `priceInfo.linePrice` (string like "$159.00"), `priceInfo.wasPrice`, `priceInfo.savings`
  - PDP: nested — `priceInfo.currentPrice.price` (number), `priceInfo.wasPrice.price`

## Auth
- No auth needed for public product data
- `requires_auth: false`

## Transport
- `transport: node` — direct HTTP fetch from Node.js
- No browser needed — the runtime's node-based SSR extraction fetches HTML and parses `__NEXT_DATA__`

## Extraction
- `ssr_next_data` on all 3 operations
- Search: `props.pageProps.initialData.searchResult`
- Product detail: `props.pageProps.initialData.data.product`
- Pricing: `props.pageProps.initialData.data.product.priceInfo`
- Product pages also have `data.idml` (specs/highlights) and `data.reviews` at the same level — available for future operations

## Known Issues
- **PerimeterX bot detection** blocks all CDP-connected browsers (headless and non-headless). Navigating to any walmart.com URL in the managed browser redirects to `/blocked?url=...` ("Robot or human?" challenge). Direct HTTP fetch from Node.js is not blocked.
- **Search results cause persistent verify DRIFT** — different products returned each call, with varying field structures. Schema validation passes; only the fingerprint hash changes. Expected behavior for dynamic endpoints.
- **`averageRating` nullable** — some search result items have `null` rating. Schema uses `type: [number, "null"]`.
- **URL redirects** — `/ip/{itemId}` (short form) redirects to canonical `/ip/{slug}/{itemId}`. Both work; `fetchWithRedirects` handles this transparently.
