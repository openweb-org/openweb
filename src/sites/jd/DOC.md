# JD.com

## Overview
Chinese e-commerce (京东). Product search, detail, reviews, and pricing via DOM extraction.

## Workflows

### Search and view product
1. `searchProducts(keyword)` → products with `skuId`
2. `getProductDetail(skuId)` → full product info
3. `getProductPrice(skuId)` → current price and promotions

### Check reviews before buying
1. `searchProducts(keyword)` → pick product → `skuId`
2. `getProductReviews(skuId)` → review count, good rate, individual reviews

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search products by keyword | keyword, page? | skuId, name, price, shopName, sales | entry point, 30/page |
| getProductDetail | product detail by SKU | skuId ← searchProducts | name, price, images, variants, reviewCount | pageConfig + DOM |
| getProductReviews | product reviews by SKU | skuId ← searchProducts | totalCount, goodRate, tags, reviews | DOM extraction |
| getProductPrice | product price by SKU | skuId ← searchProducts | currentPrice, originalPrice, inStock, promotions | DOM extraction |

## Quick Start

```bash
# Search for phones
openweb jd exec searchProducts '{"keyword":"手机"}'

# Get product detail
openweb jd exec getProductDetail '{"skuId":"100085781898"}'

# Get reviews
openweb jd exec getProductReviews '{"skuId":"100085781898"}'

# Get price
openweb jd exec getProductPrice '{"skuId":"100085781898"}'
```

---

## Site Internals

## API Architecture
- No JSON API available without login — all data extracted from rendered DOM
- Search results from `search.jd.com` DOM (`[data-sku]` elements)
- Product data from `item.jd.com` via `window.pageConfig.product` + DOM price/review elements
- Prior version used h5st-signed API on global.jd.com — replaced with DOM extraction for reliability

## Auth
No auth required. All operations work on public pages without login.

## Transport
- `transport: page` — L3 adapter for all operations
- Search navigates to `search.jd.com/Search?keyword=...`
- Detail/reviews/price navigate to `item.jd.com/{skuId}.html`
- Each operation does a full page navigation (no SPA routing between subdomains)

## Extraction
- L3 adapter: `jd-global-api`
- Search: DOM extraction from `[data-sku]` elements — name from `[title]`, price from ¥ text nodes, shop from mall/shop links
- Product detail: `window.pageConfig.product` for structured data + DOM for price
- Reviews: DOM text extraction from `.comment-root` / `.comment-user` elements
- Price: DOM extraction from `.p-price .price` element

## Known Issues
- **CSS module class names**: Search page uses hashed CSS class names that change between deployments. Adapter uses attribute-based selectors (`[data-sku]`, `[title]`) and text pattern matching for resilience.
- **Price and shop missing in search**: Some product cards may not render price/shop if elements use different CSS classes. Name and SKU ID are always available.
- **Review count format**: Review counts may be formatted as "200+", "5万+" etc. Returned as string to preserve format.
- **International redirect**: `www.jd.com` redirects to `corporate.jd.com` for international traffic. Adapter uses `search.jd.com` and `item.jd.com` directly.
- **Rate limiting**: JD has bot detection on search. Heavy use may trigger CAPTCHA.
