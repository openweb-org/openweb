# Best Buy

## Overview
E-commerce — electronics retailer. Three read APIs for product search, details, and pricing, plus one write API for add-to-cart.

## Operations
| Operation | Intent | Method | Safety | Notes |
|-----------|--------|--------|--------|-------|
| searchProducts | search by keyword | GET /suggest/v1/fragment/suggest/www?query= | ✅ read | returns suggestion terms, categories, and top SKU IDs |
| getProductDetails | get product info by SKU | GET /suggest/v1/fragment/products/www?skuids= | ✅ read | returns name, image, rating, review count |
| getProductPricing | get pricing by SKU | GET /api/3.0/priceBlocks?skus= | ✅ read | returns current/regular price, savings, condition, availability, brand |
| addToCart | add product to cart by SKU | POST /cart/api/v1/addToCart | ⚠️ CAUTION | adds item to cart only, NEVER checkout/purchase. Returns cart count, subtotal, and item price details |

## API Architecture
- REST, same-origin on `www.bestbuy.com`
- Search flow: `searchProducts` returns SKU IDs → pass them to `getProductDetails` and `getProductPricing`
- Cart flow: `addToCart` accepts SKU IDs → returns cart summary with count, subtotal, and per-item pricing
- `searchProducts` is the typeahead/suggestion API, not the full search backend — returns top ~9 products per term
- `priceBlocks` is the canonical pricing API, returning rich data (offers, open-box, protection plans) for up to ~10 SKUs per call
- `addToCart` is the cart mutation API at `/cart/api/v1/addToCart`, accepts `{items: [{skuId}]}` JSON body
- `x-client-id: Search-Web-View` header required on suggest endpoints

## Auth
- cookie_session (Akamai-managed session cookies: SID, CTT, vt)
- No user login required for public data
- Cookies are set automatically when browsing bestbuy.com
- `authorization: undefined` sent literally by the frontend (not a real auth header)

## Transport
- **page** (browser_fetch) — required
- Akamai bot protection blocks all direct HTTP (curl, node fetch) with HTTP/2 INTERNAL_ERROR
- Must call APIs via `fetch()` from within a browser page on bestbuy.com
- Homepage or search page is sufficient as the open page

## Known Issues
- **PDP blocked**: Product detail page navigation fails in headless browser (HTTP/2 protocol error). Only homepage and search listing pages load. PDP data available via APIs instead.
- **Compiler incompatible**: `pnpm dev compile` filters out all 384 captured requests — manual fixture creation required. The analyzer doesn't recognize Best Buy's API patterns.
- **SKU format**: Some newer SKUs (e.g. 12009400) return 404 on priceBlocks — these may be virtual/bundle SKUs. Older 7-digit SKUs (e.g. 6614950) work reliably.
- **Rate limiting**: Not observed during testing, but Akamai may throttle rapid API calls.
