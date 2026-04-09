# Amazon

## Overview
E-commerce marketplace — search products, view details, read reviews, browse deals, manage cart.

## Workflows

### Search and view product details
1. `searchProducts(k)` → product list with `asin`
2. `getProductDetail(asin)` → full product info (name, price, brand, rating)
3. `getProductReviews(asin)` → customer reviews

### Browse deals
1. `searchDeals(startIndex, pageSize)` → deal products with pricing and badges
2. `getProductDetail(asin)` ← asin from deal product → full product info

### Discover trending products
1. `getBestSellers` → ranked best-selling products

### Cart operations
1. `searchProducts(k)` → find product `asin`
2. `addToCart(asin)` → add product to cart (returns confirmation, cart count)
3. `getCart` → view current cart contents (items, quantities, subtotal)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search products by keyword | k (query) | asin, title, price, rating | entry point; paginated (page param) |
| getProductDetail | view full product info | asin ← searchProducts | name, price, brand, description, rating, reviewCount | JSON-LD extraction |
| getProductReviews | read customer reviews | asin ← searchProducts | rating, title, body, author, date | paginated (pageNumber); sortBy: recent/helpful |
| searchDeals | browse active deals | startIndex, pageSize | asin, title, price, dealBadge, percentClaimed | JSON API; paginated (nextIndex) |
| getBestSellers | view best sellers | — | title, price, rating, link | entry point |
| addToCart | add product to cart | asin ← searchProducts, quantity? | success, cartCount, subtotal | write op; clicks Add to Cart button |
| getCart | view cart contents | — | items (asin, title, price, quantity), subtotal | reads cart page DOM |

## Quick Start

```bash
# Search for products
openweb amazon exec searchProducts '{"k": "laptop"}'

# Get product details by ASIN
openweb amazon exec getProductDetail '{"asin": "B00MVWGQX0"}'

# Get product reviews
openweb amazon exec getProductReviews '{"asin": "B00MVWGQX0"}'

# Browse current deals
openweb amazon exec searchDeals '{"startIndex": 1, "pageSize": 20}'

# View best sellers
openweb amazon exec getBestSellers '{}'

# Add product to cart
openweb amazon exec addToCart '{"asin": "B00MVWGQX0"}'

# View cart
openweb amazon exec getCart '{}'
```

---

## Site Internals

## API Architecture
Amazon serves most content via server-side rendered HTML pages. The deals page
(`/d2b/api/v1/products/search`) is a true JSON API. Product detail pages embed
JSON-LD (`<script type="application/ld+json">`) with structured product data.
Search results and reviews are extracted from the rendered DOM.

## Auth
- Auth type: `cookie_session` (Amazon session cookies: `session-id`, `session-token`, `at-main`, `x-main`)
- No CSRF token required for read operations
- Cookies are extracted from the browser automatically

## Transport
- `page` transport required — Amazon uses Akamai Bot Manager which blocks all direct Node.js HTTP
- All operations execute via `page.evaluate(fetch(...))` or DOM extraction in the browser
- Requires `openweb browser start` before use

## Extraction
- **searchProducts**: `html_selector` — extracts from `[data-component-type="s-search-result"]` DOM elements
- **getProductDetail**: `script_json` — parses `<script type="application/ld+json">` (Schema.org Product)
- **getProductReviews**: `html_selector` — extracts from `[data-hook="review"]` DOM elements
- **getBestSellers**: `html_selector` — extracts from `#gridItemRoot` DOM elements
- **addToCart**: `adapter` — navigates to product page, clicks Add to Cart button, extracts confirmation
- **getCart**: `adapter` — navigates to `/gp/cart/view.html`, extracts cart items from `[data-asin][data-itemtype="active"]`

## Known Issues
- **Akamai Bot Manager**: Node transport fails (403 with invalid `_abck` cookie). Must use page transport.
- **Rate limiting**: Amazon aggressively rate-limits automated requests. Keep operations spaced.
- **Dynamic content**: Some product pages use lazy loading; initial extraction may miss below-fold content.
- **HTML selectors fragile**: Amazon's DOM structure changes periodically. Verify regularly.
